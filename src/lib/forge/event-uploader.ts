/**
 * Forge Event Uploader — Track 2 (Supabase persistence)
 *
 * Watches .forge/<runId>/events.jsonl files and batch-uploads events to Supabase.
 * - Batches up to 10 events or 200ms (whichever comes first)
 * - Idempotent via UNIQUE constraint on (runId, seq)
 * - Uses forge_next_seq() for monotonic sequence per run
 *
 * This runs as a background process (started by orchestrator).
 */

import "server-only";
import { watch } from "chokidar";
import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname, basename } from "node:path";
import { db } from "@/lib/db";
import type { Json } from "@/lib/supabase/database.types";

const FORGE_DIR = ".forge";
const BATCH_SIZE = 10;
const BATCH_TIMEOUT_MS = 200;

type ForgeEventLocal = {
  runId: string;
  taskId?: string;
  ts: string;
  kind: "tool_call" | "tool_result" | "status" | "thought" | "token" | "spawn" | "task_spawn" | "metric" | "error" | "done";
  payload: Record<string, unknown>;
};

type EventBatch = {
  runId: string;
  events: ForgeEventLocal[];
  timer?: NodeJS.Timeout;
};

const batches = new Map<string, EventBatch>();

/**
 * Start watching .forge directory for events.jsonl files
 */
export function startEventUploader() {
  const pattern = resolve(FORGE_DIR, "*", "events.jsonl");

  console.log(`[event-uploader] Watching: ${pattern}`);

  const watcher = watch(pattern, {
    persistent: true,
    ignoreInitial: false,
    awaitWriteFinish: {
      stabilityThreshold: 50,
      pollInterval: 25,
    },
  });

  watcher.on("add", (path: string) => {
    console.log(`[event-uploader] New events.jsonl detected: ${path}`);
    processEventsFile(path);
  });

  watcher.on("change", (path: string) => {
    processEventsFile(path);
  });

  watcher.on("error", (error: unknown) => {
    console.error("[event-uploader] Watcher error:", error);
  });

  // Graceful shutdown
  process.on("SIGINT", () => {
    console.log("\n[event-uploader] Shutting down...");
    watcher.close();
    // Flush pending batches
    for (const [runId, batch] of batches.entries()) {
      if (batch.timer) clearTimeout(batch.timer);
      if (batch.events.length > 0) {
        void flushBatch(runId);
      }
    }
    process.exit(0);
  });

  return watcher;
}

/**
 * Process events.jsonl file and batch upload to Supabase
 */
function processEventsFile(filePath: string) {
  if (!existsSync(filePath)) return;

  // Extract runId from path: .forge/<runId>/events.jsonl
  const runId = basename(dirname(filePath));

  // Read file and parse JSONL
  const content = readFileSync(filePath, "utf-8");
  const lines = content.trim().split("\n").filter(Boolean);

  const newEvents: ForgeEventLocal[] = [];
  for (const line of lines) {
    try {
      const event = JSON.parse(line) as ForgeEventLocal;
      newEvents.push(event);
    } catch (err) {
      console.error(`[event-uploader] Failed to parse event line: ${line}`, err);
    }
  }

  if (newEvents.length === 0) return;

  // Add to batch
  let batch = batches.get(runId);
  if (!batch) {
    batch = { runId, events: [] };
    batches.set(runId, batch);
  }

  batch.events.push(...newEvents);

  // Flush if batch size reached
  if (batch.events.length >= BATCH_SIZE) {
    if (batch.timer) {
      clearTimeout(batch.timer);
      batch.timer = undefined;
    }
    void flushBatch(runId);
    return;
  }

  // Schedule flush after timeout
  if (!batch.timer) {
    batch.timer = setTimeout(() => {
      void flushBatch(runId);
    }, BATCH_TIMEOUT_MS);
  }
}

/**
 * Flush batch to Supabase
 */
async function flushBatch(runId: string) {
  const batch = batches.get(runId);
  if (!batch || batch.events.length === 0) return;

  const events = batch.events;
  batch.events = [];
  if (batch.timer) {
    clearTimeout(batch.timer);
    batch.timer = undefined;
  }

  try {
    // Upload events in a transaction with sequence numbering
    // We'll use a stored procedure to handle sequence generation and insert
    for (const event of events) {
      // Get next sequence number using forge_next_seq function
      const { data: seqData, error: seqError } = await db().rpc("forge_next_seq", {
        p_run: event.runId,
      });

      if (seqError) {
        console.error(`[event-uploader] Failed to get next seq for run ${event.runId}:`, seqError);
        continue;
      }

      const seq = seqData as number;

      // Insert event
      const { error: insertError } = await db()
        .from("ForgeEvent")
        .insert({
          runId: event.runId,
          seq,
          taskId: event.taskId ?? null,
          ts: event.ts,
          kind: event.kind,
          payload: event.payload as Json,
        });

      if (insertError) {
        // Check if it's a duplicate (unique constraint violation)
        if (insertError.code === "23505") {
          // Duplicate, skip silently (idempotent)
          continue;
        }
        console.error(`[event-uploader] Failed to insert event:`, insertError);
      }
    }

    console.log(`[event-uploader] Uploaded ${events.length} events for run ${runId}`);
  } catch (err) {
    console.error(`[event-uploader] Batch upload failed for run ${runId}:`, err);
    // Re-add events to batch for retry
    batch.events.unshift(...events);
  }
}

/**
 * Stop the event uploader (for testing/cleanup)
 */
export function stopEventUploader(watcher: ReturnType<typeof watch>) {
  watcher.close();
  for (const [runId, batch] of batches.entries()) {
    if (batch.timer) clearTimeout(batch.timer);
    batches.delete(runId);
  }
}
