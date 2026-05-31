#!/usr/bin/env tsx
/**
 * Forge Daemon — Background process that claims and executes ForgeJobs.
 *
 * Workflow:
 * 1. Load or create ~/.forge/daemon.json with persistent daemonId
 * 2. Subscribe to ForgeJob realtime (INSERT/UPDATE) + poll fallback (30s)
 * 3. Claim next queued job atomically via DAL
 * 4. Spawn exec-prd.ts with job context
 * 5. Heartbeat loop (UPDATE heartbeatAt every 30s while running)
 * 6. Update job status on completion (done | failed)
 * 7. Repeat
 *
 * Usage: tsx scripts/forge/daemon.ts [--daemon-id <uuid>]
 */
import "dotenv/config";
import { randomUUID } from "node:crypto";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { spawn, type ChildProcess } from "node:child_process";
import { db } from "../../src/lib/db";
import {
  claimNextJob,
  updateJobStatus,
  heartbeat,
  type ForgeJobRow,
} from "../../src/lib/forge/dal/job";

// ── Colors ────────────────────────────────────────────────────────────────
const dim = (s: string) => `\x1b[2m${s}\x1b[0m`;
const yellow = (s: string) => `\x1b[33m${s}\x1b[0m`;
const cyan = (s: string) => `\x1b[36m${s}\x1b[0m`;
const green = (s: string) => `\x1b[32m${s}\x1b[0m`;
const red = (s: string) => `\x1b[31m${s}\x1b[0m`;

// ── Daemon config ─────────────────────────────────────────────────────────

type DaemonConfig = {
  daemonId: string;
  memberId: string; // Member.id from Supabase (stub for now)
  createdAt: string;
};

const DAEMON_CONFIG_DIR = resolve(process.env.HOME ?? "~", ".forge");
const DAEMON_CONFIG_PATH = resolve(DAEMON_CONFIG_DIR, "daemon.json");
const DAEMON_PID_PATH = resolve(DAEMON_CONFIG_DIR, "daemon.pid");
const DAEMON_LOG_PATH = resolve(DAEMON_CONFIG_DIR, "daemon.log");

function loadOrCreateDaemonConfig(): DaemonConfig {
  if (existsSync(DAEMON_CONFIG_PATH)) {
    const raw = readFileSync(DAEMON_CONFIG_PATH, "utf-8");
    return JSON.parse(raw) as DaemonConfig;
  }

  // Create new config
  const config: DaemonConfig = {
    daemonId: randomUUID(),
    memberId: "00000000-0000-0000-0000-000000000000", // Stub — replace with actual auth
    createdAt: new Date().toISOString(),
  };

  mkdirSync(DAEMON_CONFIG_DIR, { recursive: true });
  writeFileSync(DAEMON_CONFIG_PATH, JSON.stringify(config, null, 2) + "\n");

  console.log(green(`✓ Created daemon config: ${DAEMON_CONFIG_PATH}`));
  console.log(dim(`  Daemon ID: ${config.daemonId}`));

  return config;
}

// ── Job executor ──────────────────────────────────────────────────────────

type JobExecution = {
  job: ForgeJobRow;
  process: ChildProcess;
  heartbeatInterval: NodeJS.Timeout;
  startedAt: Date;
};

async function executeJob(
  job: ForgeJobRow,
  daemonId: string,
): Promise<JobExecution> {
  console.log("");
  console.log(cyan(`→ Executing job ${job.id}`));
  console.log(dim(`  PRD: ${job.prdSlug}`));

  const repoRoot = process.cwd();
  const execPrdPath = resolve(repoRoot, "scripts/forge/exec-prd.ts");

  // Extract prdSlug from job
  const prdSlug = job.prdSlug;

  if (!prdSlug) {
    throw new Error(`Job ${job.id} missing prdSlug in meta`);
  }

  // Update job status to 'running'
  await updateJobStatus(job.id, "running", { runId: job.runId ?? null });

  // Spawn exec-prd.ts
  const autorunId = job.runId ?? randomUUID();
  const child = spawn("npx", ["tsx", execPrdPath, autorunId, prdSlug, "20"], {
    cwd: repoRoot,
    detached: false,
    stdio: "inherit", // Stream to daemon's stdout
    env: {
      ...process.env,
      FORGE_JOB_ID: job.id,
    },
  });

  console.log(green(`  ✓ Spawned exec-prd.ts (PID ${child.pid})`));

  // Setup heartbeat loop (every 30s)
  const heartbeatInterval = setInterval(async () => {
    try {
      const updated = await heartbeat(job.id, daemonId);
      if (updated) {
        const ts = new Date().toLocaleTimeString();
        console.log(dim(`  [${ts}] Heartbeat OK`));
      } else {
        console.warn(yellow(`  [!] Heartbeat failed — job may have been reclaimed`));
      }
    } catch (err) {
      console.error(red(`  [!] Heartbeat error: ${err}`));
    }
  }, 30_000);

  return {
    job,
    process: child,
    heartbeatInterval,
    startedAt: new Date(),
  };
}

async function waitForJobCompletion(
  execution: JobExecution,
): Promise<{ ok: boolean; exitCode: number | null }> {
  return new Promise((resolve) => {
    execution.process.on("close", (code) => {
      clearInterval(execution.heartbeatInterval);
      resolve({ ok: code === 0, exitCode: code });
    });

    execution.process.on("error", (err) => {
      console.error(red(`✗ Job process error: ${err.message}`));
      clearInterval(execution.heartbeatInterval);
      resolve({ ok: false, exitCode: -1 });
    });
  });
}

// ── Daemon main loop ──────────────────────────────────────────────────────

async function runDaemon() {
  const config = loadOrCreateDaemonConfig();

  // Write PID file
  mkdirSync(DAEMON_CONFIG_DIR, { recursive: true });
  writeFileSync(DAEMON_PID_PATH, String(process.pid));

  console.log("");
  console.log(cyan("═══ Forge Daemon ═══"));
  console.log("");
  console.log(`  Daemon ID: ${dim(config.daemonId)}`);
  console.log(`  Member ID: ${dim(config.memberId)}`);
  console.log(`  PID: ${dim(String(process.pid))}`);
  console.log("");
  console.log(yellow("→ Listening for jobs..."));
  console.log(dim("  Press Ctrl+C to stop gracefully"));
  console.log("");

  let shutdownRequested = false;
  let currentExecution: JobExecution | null = null;

  const handleShutdown = () => {
    console.log("");
    console.log(yellow("→ Shutdown requested..."));
    shutdownRequested = true;

    if (currentExecution) {
      console.log(yellow("  Waiting for current job to complete..."));
    } else {
      console.log(green("  No active job. Exiting."));
      process.exit(0);
    }
  };

  process.on("SIGINT", handleShutdown);
  process.on("SIGTERM", handleShutdown);

  // Setup realtime subscription
  const client = db();
  const channel = client
    .channel("forge-jobs")
    .on(
      "postgres_changes",
      {
        event: "*",
        schema: "public",
        table: "ForgeJob",
        filter: `status=eq.queued`,
      },
      (payload) => {
        const ts = new Date().toLocaleTimeString();
        console.log(dim(`  [${ts}] Realtime event: ${payload.eventType}`));
        // Trigger immediate poll on next iteration
      },
    )
    .subscribe();

  console.log(dim(`  Realtime subscribed to ForgeJob changes`));

  // Main loop: poll + claim + execute
  while (!shutdownRequested) {
    try {
      // Try to claim next job
      const job = await claimNextJob(config.daemonId, config.memberId);

      if (job) {
        console.log(green(`✓ Claimed job: ${job.id}`));
        currentExecution = await executeJob(job, config.daemonId);

        const { ok, exitCode } = await waitForJobCompletion(currentExecution);

        const durationMs = Date.now() - currentExecution.startedAt.getTime();
        const durationSec = Math.round(durationMs / 1000);

        if (ok) {
          await updateJobStatus(job.id, "done");
          console.log(green(`✓ Job ${job.id} completed successfully (${durationSec}s)`));
        } else {
          await updateJobStatus(job.id, "failed");
          console.error(
            red(`✗ Job ${job.id} failed (exit code: ${exitCode}, ${durationSec}s)`),
          );
        }

        currentExecution = null;

        if (shutdownRequested) {
          console.log(green("  Job completed. Exiting."));
          break;
        }
      } else {
        // No job available — wait for next poll cycle
        await sleep(30_000); // 30s fallback polling
      }
    } catch (err) {
      console.error(red(`✗ Daemon error: ${err}`));
      await sleep(5_000); // Back off on error
    }
  }

  // Cleanup
  await channel.unsubscribe();

  // Remove PID file
  if (existsSync(DAEMON_PID_PATH)) {
    writeFileSync(DAEMON_PID_PATH, "");
  }

  console.log(green("✓ Daemon stopped"));
  process.exit(0);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ── CLI entry point ───────────────────────────────────────────────────────

runDaemon().catch((err) => {
  console.error(red("✗ Daemon crashed"));
  console.error("");
  console.error(`  ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
