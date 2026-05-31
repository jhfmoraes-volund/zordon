/**
 * Forge Worker — Spawn isolated Claude Code agents in git worktrees.
 *
 * Each worker:
 * - Runs in an isolated git worktree (.forge/<run-id>/tasks/<task-id>/worktree)
 * - Uses a dedicated branch (forge/<run-id>/<task-id>)
 * - Spawns as a detached process (survives page reload per D27)
 * - Maps agentProfile → subagent_type for Agent tool
 *
 * Process lifecycle:
 * 1. Create worktree + branch
 * 2. Spawn claude-code via Agent tool (detached, unref)
 * 3. Monitor completion
 * 4. On success: merge to joao-dev
 * 5. On failure: cleanup worktree, preserve error.log
 */

import "server-only";
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync, existsSync, rmSync, readFileSync, createWriteStream } from "node:fs";
import { resolve, dirname } from "node:path";
import type { ForgeTaskRow } from "./dal/run";
import { execSync } from "node:child_process";
import { parseCost, type CostSummary } from "./cost-parser";

const FORGE_DIR = ".forge";

export type WorkerResult = {
  success: boolean;
  taskId: string;
  worktreePath: string;
  branch: string;
  errorLog?: string;
  cost?: CostSummary;
};

export type WorkerProcess = {
  taskId: string;
  runId: string;
  worktreePath: string;
  branch: string;
  pid: number;
  startedAt: Date;
  process: ReturnType<typeof spawn>;
};

/**
 * Spawn a worker for a task in an isolated git worktree.
 *
 * Steps:
 * 1. Create worktree directory
 * 2. Create git worktree from joao-dev
 * 3. Create branch forge/<run-id>/<task-id>
 * 4. Spawn claude-code agent (detached, unref)
 * 5. Return worker handle
 *
 * The worker process runs detached and survives parent termination (D27).
 */
export async function spawnWorker(task: ForgeTaskRow): Promise<WorkerProcess> {
  const runId = task.runId;
  if (!runId) {
    throw new Error(`Task ${task.id} has no runId`);
  }

  const worktreePath = resolve(FORGE_DIR, runId, "tasks", task.id, "worktree");
  const branch = `forge/${runId}/${task.id}`;
  const logPath = resolve(dirname(worktreePath), "worker.log");
  const errorLogPath = resolve(dirname(worktreePath), "error.log");
  const streamJsonPath = resolve(dirname(worktreePath), "stream.jsonl");

  // Ensure parent directory exists
  mkdirSync(dirname(worktreePath), { recursive: true });

  try {
    // 1. Create git worktree from joao-dev
    console.log(`→ Creating worktree for task ${task.id}: ${worktreePath}`);

    // Remove worktree if it already exists (cleanup from previous run)
    if (existsSync(worktreePath)) {
      console.log(`  Cleaning up existing worktree: ${worktreePath}`);
      try {
        execSync(`git worktree remove -f ${worktreePath}`, { stdio: "pipe" });
      } catch {
        // Ignore errors, worktree might be corrupted
        console.warn(`  Warning: failed to remove worktree, attempting manual cleanup`);
        rmSync(worktreePath, { recursive: true, force: true });
      }
    }

    // Create new worktree
    execSync(`git worktree add -b ${branch} ${worktreePath} joao-dev`, {
      stdio: "pipe",
      encoding: "utf-8",
    });

    console.log(`✓ Worktree created: ${worktreePath}`);
    console.log(`✓ Branch created: ${branch}`);

    // 2. Build agent prompt from task metadata
    const meta = (task.meta as Record<string, unknown>) ?? {};
    const acceptanceCriteria = Array.isArray(meta.acceptanceCriteria)
      ? (meta.acceptanceCriteria as string[])
      : [];
    const verifiable = Array.isArray(meta.verifiable)
      ? (meta.verifiable as Array<{ kind: string; command_or_query: string; expected: string }>)
      : [];
    const description = (meta.description as string) ?? task.title;
    const agentProfile = (meta.agentProfile as string) ?? "wiring";

    const prompt = buildWorkerPrompt({
      taskId: task.id,
      title: task.title,
      description,
      acceptanceCriteria,
      verifiable,
      agentProfile,
    });

    // Write prompt to file for inspection
    const promptPath = resolve(dirname(worktreePath), "prompt.txt");
    writeFileSync(promptPath, prompt);

    // 3. Spawn claude-code agent as detached process
    // Map agentProfile to subagent_type
    const subagentType = mapAgentProfileToSubagent(agentProfile);

    console.log(`→ Spawning ${subagentType} agent for task ${task.id} (PID will be assigned)`);

    // Spawn detached process
    // In production, this would be:
    //   claude-code -p prompt.txt --output-format=stream-json > stream.jsonl
    const mockWorkerCode = `
        const fs = require('fs');
        const path = require('path');

        // Mock stream-json output
        const streamJsonPath = path.join(__dirname, '..', 'stream.jsonl');
        const stream = fs.createWriteStream(streamJsonPath, { flags: 'w' });

        // Mock message_start event
        stream.write(JSON.stringify({
          type: 'message_start',
          message: {
            model: 'claude-sonnet-4-5-20250929',
            usage: { input_tokens: 1500, output_tokens: 0 }
          }
        }) + '\\n');

        // Simulate work
        setTimeout(() => {
          // Mock usage event with final counts
          stream.write(JSON.stringify({
            type: 'usage',
            usage: { input_tokens: 1500, output_tokens: 800 }
          }) + '\\n');

          stream.end();
          process.exit(0);
        }, 2000); // 2 seconds mock
    `;

    const childProcess = spawn("node", ["-e", mockWorkerCode], {
      cwd: worktreePath,
      detached: true,
      stdio: ["ignore", "pipe", "pipe"],
    });

    // Unref to allow parent to exit without waiting for child
    childProcess.unref();

    // Pipe stdout/stderr to log file
    const logStream = createWriteStream(logPath, { flags: "a" });
    childProcess.stdout?.pipe(logStream);
    childProcess.stderr?.pipe(logStream);

    // Handle process exit
    childProcess.on("exit", (code) => {
      console.log(`Worker for task ${task.id} exited with code ${code}`);
      logStream.end();
    });

    console.log(`✓ Worker spawned (PID ${childProcess.pid})`);

    return {
      taskId: task.id,
      runId,
      worktreePath,
      branch,
      pid: childProcess.pid ?? 0,
      startedAt: new Date(),
      process: childProcess,
    };
  } catch (error) {
    // Cleanup worktree on failure, but preserve error log
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(`✗ Failed to spawn worker for task ${task.id}: ${errorMessage}`);

    writeFileSync(errorLogPath, `Error spawning worker:\n${errorMessage}\n`);

    // Remove worktree but keep logs
    if (existsSync(worktreePath)) {
      try {
        execSync(`git worktree remove -f ${worktreePath}`, { stdio: "pipe" });
      } catch {
        rmSync(worktreePath, { recursive: true, force: true });
      }
    }

    throw error;
  }
}

/**
 * Build agent prompt from task metadata.
 */
function buildWorkerPrompt(params: {
  taskId: string;
  title: string;
  description: string;
  acceptanceCriteria: string[];
  verifiable: Array<{ kind: string; command_or_query: string; expected: string }>;
  agentProfile: string;
}): string {
  const { taskId, title, description, acceptanceCriteria, verifiable, agentProfile } = params;

  return `# Task: ${title}

**ID:** ${taskId}
**Agent Profile:** ${agentProfile}

## Description

${description}

## Acceptance Criteria

${acceptanceCriteria.map((ac, i) => `${i + 1}. ${ac}`).join("\n")}

## Verifiable Checks

${verifiable.map((v, i) => `${i + 1}. **${v.kind}**: \`${v.command_or_query}\` → expected: ${v.expected}`).join("\n")}

## Instructions

1. Read existing files referenced above (and any others you find relevant).
2. Implement the task to satisfy ALL acceptance criteria.
3. Run the verifiable checks; iterate until they pass.
4. When done, commit your changes with a descriptive message.

**Constraints:**
- Don't add features beyond what the task requires.
- Don't refactor unrelated code.
- If a verifiable check fails after 2 attempts, stop and report the blocker.
- Follow existing repo patterns (read neighbors before writing).

Begin.
`;
}

/**
 * Map agentProfile to Claude Code Agent subagent_type.
 */
function mapAgentProfileToSubagent(profile: string): string {
  const mapping: Record<string, string> = {
    db: "general-purpose", // DB migrations need general tools
    api: "general-purpose", // API endpoints need general tools
    ui: "general-purpose", // UI components need general tools
    wiring: "general-purpose", // Integration/glue code
    test: "general-purpose", // Tests need general tools
    doc: "general-purpose", // Documentation
  };

  return mapping[profile] ?? "general-purpose";
}

/**
 * Check if worker has completed.
 * Returns true if process has exited.
 */
export function checkWorkerCompletion(worker: WorkerProcess): boolean {
  // Check if process is still alive
  try {
    process.kill(worker.pid, 0); // signal 0 = check existence
    return false; // Process still alive
  } catch (err) {
    if (err instanceof Error && (err as NodeJS.ErrnoException).code === "ESRCH") {
      return true; // Process doesn't exist = completed
    }
    throw err;
  }
}

/**
 * Wait for worker to complete (blocking).
 */
export async function waitForWorker(worker: WorkerProcess): Promise<WorkerResult> {
  return new Promise((resolvePromise) => {
    worker.process.on("exit", async (code) => {
      const success = code === 0;
      const errorLogPath = resolve(dirname(worker.worktreePath), "error.log");
      const streamJsonPath = resolve(dirname(worker.worktreePath), "stream.jsonl");

      const errorLog = existsSync(errorLogPath)
        ? readFileSync(errorLogPath, "utf-8")
        : undefined;

      // Parse cost from stream.jsonl if it exists
      let cost: CostSummary | undefined;
      if (existsSync(streamJsonPath)) {
        try {
          const streamJson = readFileSync(streamJsonPath, "utf-8");
          cost = await parseCost(streamJson);
        } catch (err) {
          console.warn(`Failed to parse cost from stream.jsonl: ${err}`);
        }
      }

      resolvePromise({
        success,
        taskId: worker.taskId,
        worktreePath: worker.worktreePath,
        branch: worker.branch,
        errorLog,
        cost,
      });
    });
  });
}

/**
 * Cleanup worktree and branch after worker completion.
 * Preserves error.log if present.
 */
export function cleanupWorker(worker: WorkerProcess, preserveLogs = true): void {
  const { worktreePath, branch } = worker;

  console.log(`→ Cleaning up worker for task ${worker.taskId}`);

  // Remove worktree
  if (existsSync(worktreePath)) {
    try {
      execSync(`git worktree remove -f ${worktreePath}`, { stdio: "pipe" });
    } catch {
      rmSync(worktreePath, { recursive: true, force: true });
    }
  }

  // Delete branch (if not merged)
  try {
    execSync(`git branch -D ${branch}`, { stdio: "pipe" });
  } catch {
    // Branch might already be deleted or merged
  }

  // Remove log directory if not preserving
  if (!preserveLogs) {
    const logDir = dirname(worktreePath);
    if (existsSync(logDir)) {
      rmSync(logDir, { recursive: true, force: true });
    }
  }

  console.log(`✓ Cleanup complete for task ${worker.taskId}`);
}
