import { appendFileSync } from "fs";
import { db } from "../../db";
import type { ForgeEventKind } from "./event-kinds";

/**
 * Configuration for creating a ForgeEvent emitter.
 */
export type EmitterConfig = {
  runId: string;
  agentId?: string | null;
  taskId?: string | null;
  jsonlPath: string;
};

/**
 * ForgeEvent emitter interface.
 *
 * - emit(): synchronous dual-write (jsonl + in-memory queue)
 * - flush(): explicitly flush pending events to DB (returns Promise)
 * - close(): final flush with 5s timeout, safe to call on process exit
 */
export type Emitter = {
  emit(kind: ForgeEventKind | string, payload?: Record<string, unknown>): void;
  flush(): Promise<void>;
  close(): Promise<void>;
};

type QueuedEvent = {
  runId: string;
  seq: number;
  agentId: string | null;
  taskId: string | null;
  kind: string;
  payload: Record<string, unknown>;
};

const MAX_QUEUE_SIZE = 10_000;
const FLUSH_INTERVAL_MS = 250;
const FLUSH_BATCH_SIZE = 100;
const MIN_BACKOFF_MS = 1_000;
const MAX_BACKOFF_MS = 60_000;

/**
 * Creates a dual-write emitter for ForgeEvent:
 *
 * 1. Synchronous append to jsonl file (debug + disaster recovery)
 * 2. Asynchronous batch INSERT to ForgeEvent table (SSOT)
 *
 * Guarantees:
 * - Events written to disk never get lost (sync write)
 * - Events eventually reach DB (retry with exponential backoff)
 * - Low latency for caller (emit() is non-blocking)
 * - Bounded memory (cap at 10k events)
 *
 * Usage:
 * ```ts
 * const emitter = createEmitter({ runId, jsonlPath: '...' });
 * emitter.emit('autorun_started', { prdPath: '...' });
 * // ...
 * await emitter.close(); // flush remaining events before exit
 * ```
 */
export function createEmitter(config: EmitterConfig): Emitter {
  const { runId, agentId = null, taskId = null, jsonlPath } = config;

  // `seq` aqui é local ao processo — escrito no jsonl (debug/recovery scope).
  // O seq que vai pro DB é atribuído no flush (MAX(runId.seq)+1), pra evitar
  // colisão de PK quando exec-prd e exec-story (sub-processo) usam o mesmo
  // runId. Ver Bug A no PRD-forge-event-ssot follow-up.
  let seq = 0;
  const queue: QueuedEvent[] = [];
  let flushTimer: NodeJS.Timeout | null = null;
  let isFlushing = false;
  let backoffMs = MIN_BACKOFF_MS;
  let isClosed = false;

  async function fetchNextDbSeq(): Promise<number> {
    const { data, error } = await db()
      .from("ForgeEvent")
      .select("seq")
      .eq("runId", runId)
      .order("seq", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) {
      console.warn("[event-writer] MAX(seq) lookup failed:", error);
      return 0;
    }
    return data?.seq ?? 0;
  }

  /**
   * Start periodic flush timer.
   */
  function startFlushTimer() {
    if (flushTimer) return;
    flushTimer = setInterval(() => {
      if (!isFlushing && queue.length > 0) {
        void flushQueue();
      }
    }, FLUSH_INTERVAL_MS);
  }

  /**
   * Stop periodic flush timer.
   */
  function stopFlushTimer() {
    if (flushTimer) {
      clearInterval(flushTimer);
      flushTimer = null;
    }
  }

  /**
   * Flush pending events to DB.
   *
   * Renumera o batch com seqs frescos (MAX(runId.seq)+1) antes do INSERT — isso
   * evita colisão de PK (runId, seq) quando múltiplos processos escrevem no
   * mesmo runId. Em caso de unique violation (raça: dois processos pegam o
   * mesmo MAX antes de qualquer um inserir), faz refetch e retenta uma vez.
   */
  async function flushQueue(): Promise<void> {
    if (isFlushing || queue.length === 0) return;

    isFlushing = true;
    const batch = queue.splice(0, FLUSH_BATCH_SIZE);

    async function tryInsert(baseSeq: number): Promise<{ ok: boolean; conflict: boolean; error?: unknown }> {
      const renumbered = batch.map((e, i) => ({
        runId: e.runId,
        seq: baseSeq + i + 1,
        agentId: e.agentId,
        taskId: e.taskId,
        kind: e.kind,
        payload: e.payload as never,
      }));
      const { error } = await db().from("ForgeEvent").insert(renumbered);
      if (!error) return { ok: true, conflict: false };
      // Postgres unique_violation = 23505. Supabase exposes via error.code.
      const conflict =
        typeof error === "object" &&
        error !== null &&
        "code" in error &&
        (error as { code?: string }).code === "23505";
      return { ok: false, conflict, error };
    }

    try {
      const baseSeq = await fetchNextDbSeq();
      let result = await tryInsert(baseSeq);

      if (!result.ok && result.conflict) {
        // Race: outro processo gravou nesse range. Refetch e tenta de novo.
        const refreshed = await fetchNextDbSeq();
        result = await tryInsert(refreshed);
      }

      if (!result.ok) {
        queue.unshift(...batch);
        console.error("[event-writer] DB insert failed, will retry:", result.error);
        await new Promise((resolve) => setTimeout(resolve, backoffMs));
        backoffMs = Math.min(backoffMs * 2, MAX_BACKOFF_MS);
      } else {
        backoffMs = MIN_BACKOFF_MS;
      }
    } catch (err) {
      queue.unshift(...batch);
      console.error("[event-writer] DB insert exception, will retry:", err);
      await new Promise((resolve) => setTimeout(resolve, backoffMs));
      backoffMs = Math.min(backoffMs * 2, MAX_BACKOFF_MS);
    } finally {
      isFlushing = false;

      if (queue.length > 0 && !isClosed) {
        void flushQueue();
      }
    }
  }

  /**
   * Emit a ForgeEvent.
   *
   * Synchronous operation:
   * 1. Increment seq counter
   * 2. Append to jsonl file (sync write)
   * 3. Push to in-memory queue
   * 4. Trigger flush if batch size reached
   */
  function emit(
    kind: ForgeEventKind | string,
    payload: Record<string, unknown> = {}
  ): void {
    if (isClosed) {
      console.warn("[event-writer] emit() called after close(), ignoring");
      return;
    }

    seq += 1;

    const event: QueuedEvent = {
      runId,
      seq,
      agentId,
      taskId,
      kind,
      payload,
    };

    // 1. Sync write to jsonl (safety net)
    try {
      const line = JSON.stringify({
        seq: event.seq,
        kind: event.kind,
        payload: event.payload,
        ts: new Date().toISOString(),
      });
      appendFileSync(jsonlPath, line + "\n", "utf-8");
    } catch (err) {
      console.error("[event-writer] Failed to write to jsonl:", err);
      // Continue anyway — DB is SSOT
    }

    // 2. Enqueue for DB flush
    if (queue.length >= MAX_QUEUE_SIZE) {
      console.warn(
        `[event-writer] Queue at capacity (${MAX_QUEUE_SIZE}), discarding event:`,
        kind
      );
      return;
    }

    queue.push(event);

    // 3. Auto-flush if batch size reached
    if (queue.length >= FLUSH_BATCH_SIZE && !isFlushing) {
      void flushQueue();
    }
  }

  /**
   * Explicit flush of pending events.
   * Waits until flush completes or errors.
   */
  async function flush(): Promise<void> {
    while (queue.length > 0 && !isFlushing) {
      await flushQueue();
    }
    // Wait for any in-progress flush to complete
    while (isFlushing) {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }

  /**
   * Close the emitter.
   * Stops periodic flush timer, does final flush with 5s timeout.
   * Safe to call multiple times.
   */
  async function close(): Promise<void> {
    if (isClosed) return;
    isClosed = true;

    stopFlushTimer();

    // Final flush with timeout
    const timeoutPromise = new Promise<void>((resolve) => {
      setTimeout(() => {
        if (queue.length > 0) {
          console.warn(
            `[event-writer] close() timeout, ${queue.length} events not flushed`
          );
        }
        resolve();
      }, 5_000);
    });

    const flushPromise = flush();

    await Promise.race([flushPromise, timeoutPromise]);
  }

  // Start periodic flush timer
  startFlushTimer();

  return { emit, flush, close };
}
