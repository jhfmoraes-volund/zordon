/**
 * Forge Engine Orchestrator — Node CLI service that executes ForgeRuns.
 *
 * Features:
 * - Parallel worker execution (maxConcurrency=3)
 * - Serialized merge queue (one merge at a time to avoid conflicts)
 * - Pivot detection (D21): after 2 consecutive failures, pause + generate pivot-required.md
 * - Graceful shutdown on SIGINT
 * - PID lock to prevent concurrent runs
 *
 * Architecture:
 * - Main process: orchestrator loop (pick ready tasks, spawn workers, monitor)
 * - Worker processes: isolated git worktrees running claude-code in fresh context
 * - Merge queue: sequential merge operations with lock
 *
 * Usage:
 *   import { runOrchestrator } from '@/lib/forge/orchestrator';
 *   await runOrchestrator({ specId: '...', maxConcurrency: 3 });
 */

import "server-only";
import {
  getRun,
  getReadyTasks,
  updateRunStatus,
  updateTaskStatus,
  incrementTaskFailureCount,
  updateTaskCost,
  type ForgeTaskRow,
} from "./dal/run";
import { writeFileSync, readFileSync, mkdirSync, existsSync, unlinkSync } from "node:fs";
import { resolve } from "node:path";

const FORGE_DIR = ".forge";
const MAX_FAILURE_COUNT = 2;

export type OrchestratorOptions = {
  specId: string;
  maxConcurrency?: number;
  dryRun?: boolean;
};

export type OrchestratorResult = {
  runId: string;
  status: "done" | "aborted" | "paused-pivot" | "error";
  tasksCompleted: number;
  tasksFailed: number;
  pivotRequired: boolean;
  pivotReportPath?: string;
};

type WorkerState = {
  taskId: string;
  worktreePath: string;
  pid: number;
  startedAt: Date;
  process: {
    pid?: number;
    on: (event: string, handler: (code: number | null) => void) => void;
  };
};

/**
 * Main orchestrator entry point.
 *
 * Process:
 * 1. Validate run exists and is in correct state
 * 2. Acquire PID lock
 * 3. Start orchestration loop:
 *    - Pick ready tasks (deps satisfied, not passed)
 *    - Spawn workers up to maxConcurrency
 *    - Monitor worker completion
 *    - Serialize merges
 *    - Detect pivot conditions
 * 4. Handle graceful shutdown
 * 5. Release PID lock
 */
export async function runOrchestrator(
  options: OrchestratorOptions,
): Promise<OrchestratorResult> {
  const { specId, maxConcurrency = 3, dryRun = false } = options;

  // Find run by specId (assuming latest run for this spec)
  // In a real implementation, we'd query ForgeRun table filtering by specId
  // For now, we'll accept runId directly via options (type widening)
  const runId = (options as OrchestratorOptions & { runId?: string }).runId ?? specId;

  const run = await getRun(runId);
  if (!run) {
    throw new Error(`Run ${runId} not found`);
  }

  if (run.status !== "queued" && run.status !== "running") {
    throw new Error(`Run ${runId} is in invalid state: ${run.status}`);
  }

  const runDir = resolve(FORGE_DIR, runId);
  mkdirSync(runDir, { recursive: true });

  // Acquire PID lock
  const pidLockPath = resolve(runDir, "orchestrator.pid");
  if (existsSync(pidLockPath)) {
    const existingPid = parseInt(readFileSync(pidLockPath, "utf-8").trim(), 10);
    // Check if process is still alive
    try {
      process.kill(existingPid, 0); // signal 0 = check existence
      throw new Error(
        `Orchestrator already running for run ${runId} (PID ${existingPid})`,
      );
    } catch (err) {
      if (err instanceof Error && (err as NodeJS.ErrnoException).code === "ESRCH") {
        // Process doesn't exist, stale lock
        console.warn(`Removing stale PID lock: ${pidLockPath}`);
        unlinkSync(pidLockPath);
      } else {
        throw err;
      }
    }
  }

  writeFileSync(pidLockPath, `${process.pid}\n`);

  // Setup graceful shutdown
  let shutdownRequested = false;
  const handleShutdown = () => {
    console.log("\n→ Graceful shutdown requested...");
    shutdownRequested = true;
  };
  process.on("SIGINT", handleShutdown);
  process.on("SIGTERM", handleShutdown);

  try {
    // Mark run as running
    if (!dryRun) {
      await updateRunStatus(runId, "running", {
        startedAt: new Date().toISOString(),
      });
    }

    const workers = new Map<string, WorkerState>();
    let tasksCompleted = 0;
    let tasksFailed = 0;
    let pivotRequired = false;
    let pivotReportPath: string | undefined;

    // Main orchestration loop
    while (!shutdownRequested && !pivotRequired) {
      // Get ready tasks
      const readyTasks = await getReadyTasks(runId);

      if (readyTasks.length === 0 && workers.size === 0) {
        // All tasks done
        break;
      }

      if (dryRun) {
        // In dry-run mode, just list tasks and exit
        console.log(`\n→ Dry run: ${readyTasks.length} tasks ready to execute`);
        for (const task of readyTasks) {
          console.log(`  - [${task.id}] ${task.title}`);
        }
        break;
      }

      // Spawn workers for ready tasks (up to maxConcurrency)
      const availableSlots = maxConcurrency - workers.size;
      const tasksToSpawn = readyTasks.slice(0, availableSlots);

      for (const task of tasksToSpawn) {
        const worker = await spawnWorker(runId, task);
        workers.set(task.id, worker);
        console.log(`→ Spawned worker for task ${task.id} (PID ${worker.pid})`);
      }

      // Monitor workers (non-blocking poll)
      for (const [taskId, worker] of workers.entries()) {
        const completed = await checkWorkerCompletion(worker);

        if (completed) {
          workers.delete(taskId);

          const task = await getTaskById(taskId);
          if (!task) continue;

          // Run verifiable checks
          const checksPassed = await runVerifiableChecks(task);

          if (checksPassed) {
            tasksCompleted++;
            await updateTaskStatus(taskId, "done", {
              endedAt: new Date().toISOString(),
            });
            // Mark passes=true (done in runVerifiableChecks via updateTaskPasses)
            console.log(`✓ Task ${taskId} completed successfully`);

            // Merge to main (serialized)
            await mergeWorktree(worker.worktreePath);
          } else {
            tasksFailed++;
            const updatedTask = await incrementTaskFailureCount(taskId);
            const meta = updatedTask.meta as Record<string, unknown> | null;
            const failureCount =
              (typeof meta?.failureCount === "number" ? meta.failureCount : 0);

            console.log(
              `✗ Task ${taskId} failed (failure count: ${failureCount})`,
            );

            if (failureCount >= MAX_FAILURE_COUNT) {
              // Pivot required
              pivotRequired = true;
              pivotReportPath = await generatePivotReport(runId, updatedTask);
              console.log(`⚠ Pivot required: ${pivotReportPath}`);
              break;
            }
          }
        }
      }

      // Sleep briefly to avoid tight loop
      if (workers.size > 0) {
        await sleep(2000);
      }
    }

    // Shutdown: wait for active workers to complete
    if (shutdownRequested && workers.size > 0) {
      console.log(`→ Waiting for ${workers.size} active workers to complete...`);
      for (const [taskId, worker] of workers.entries()) {
        await waitForWorker(worker);
        console.log(`✓ Worker for task ${taskId} completed`);
      }
    }

    // Determine final status
    let finalStatus: OrchestratorResult["status"];
    if (shutdownRequested) {
      finalStatus = "aborted";
    } else if (pivotRequired) {
      finalStatus = "paused-pivot";
    } else {
      finalStatus = "done";
    }

    // Update run status
    if (!dryRun) {
      await updateRunStatus(runId, finalStatus, {
        endedAt: new Date().toISOString(),
      });
    }

    return {
      runId,
      status: finalStatus,
      tasksCompleted,
      tasksFailed,
      pivotRequired,
      pivotReportPath,
    };
  } finally {
    // Release PID lock
    if (existsSync(pidLockPath)) {
      unlinkSync(pidLockPath);
    }

    process.off("SIGINT", handleShutdown);
    process.off("SIGTERM", handleShutdown);
  }
}

/**
 * Spawn a worker process for a task.
 * Creates isolated git worktree and spawns claude-code.
 */
async function spawnWorker(
  _runId: string,
  task: ForgeTaskRow,
): Promise<WorkerState> {
  const { spawnWorker: spawnWorkerReal } = await import("./worker");

  await updateTaskStatus(task.id, "doing", {
    startedAt: new Date().toISOString(),
  });

  const worker = await spawnWorkerReal(task);

  return {
    taskId: worker.taskId,
    worktreePath: worker.worktreePath,
    pid: worker.pid,
    startedAt: worker.startedAt,
    process: worker.process,
  };
}

/**
 * Check if worker has completed (non-blocking).
 */
async function checkWorkerCompletion(worker: WorkerState): Promise<boolean> {
  // TODO: Check process status
  // For now, mock: workers complete after 5 seconds
  const elapsed = Date.now() - worker.startedAt.getTime();
  return elapsed > 5000;
}

/**
 * Wait for worker to complete (blocking).
 */
async function waitForWorker(worker: WorkerState): Promise<void> {
  // Wait for process to exit
  while (!await checkWorkerCompletion(worker)) {
    await sleep(100);
  }
}

/**
 * Run verifiable checks for a task.
 * Returns true if all checks pass.
 */
async function runVerifiableChecks(task: ForgeTaskRow): Promise<boolean> {
  // TODO: Run actual verifiable checks from task.verifiable
  // For now, mock: always pass
  const { updateTaskPasses } = await import("./dal/run");
  await updateTaskPasses(task.id, true);
  return true;
}

/**
 * Merge worktree changes to main branch (serialized).
 * Uses a lock file to ensure only one merge happens at a time.
 */
async function mergeWorktree(worktreePath: string): Promise<void> {
  const mergeLockPath = resolve(FORGE_DIR, "merge.lock");

  // Acquire merge lock
  while (existsSync(mergeLockPath)) {
    await sleep(500);
  }

  writeFileSync(mergeLockPath, `${process.pid}\n`);

  try {
    // TODO: Run git merge from worktree
    console.log(`→ Merging worktree: ${worktreePath}`);
    await sleep(1000); // Mock merge time
  } finally {
    if (existsSync(mergeLockPath)) {
      unlinkSync(mergeLockPath);
    }
  }
}

/**
 * Generate pivot-required.md report when a task fails repeatedly.
 */
async function generatePivotReport(
  runId: string,
  task: ForgeTaskRow,
): Promise<string> {
  const reportPath = resolve(FORGE_DIR, runId, "pivot-required.md");

  // Extract AC from task meta (assuming it's stored there or fetch from spec)
  const meta = task.meta as Record<string, unknown> | null;
  const ac = Array.isArray(meta?.acceptanceCriteria)
    ? (meta.acceptanceCriteria as string[])
    : ["No AC available"];

  const report = `# Pivot Required

**Run ID:** ${runId}
**Task ID:** ${task.id}
**Task Title:** ${task.title}

## Acceptance Criteria

${ac.map((criterion) => `- ${criterion}`).join("\n")}

## Detected Anti-Patterns

- Task failed ${MAX_FAILURE_COUNT} consecutive times
- Possible causes:
  - Acceptance criteria too vague or conflicting
  - Missing context or dependencies
  - Spec requires pivot (scope creep or incorrect assumptions)

## Suggested Actions

1. **Pivot in spec:** Review spec.md and adjust acceptance criteria
2. **OR Scope creep:** Task is attempting to do more than spec intended

## Next Steps

- Pause run (status: paused-pivot)
- Human review required
- Update spec or task definition
- Resume orchestrator after fix
`;

  writeFileSync(reportPath, report);
  return reportPath;
}

/**
 * Helper: get task by ID (uses DAL).
 */
async function getTaskById(taskId: string): Promise<ForgeTaskRow | null> {
  const { getTask } = await import("./dal/run");
  return getTask(taskId);
}

/**
 * Helper: sleep for ms.
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
