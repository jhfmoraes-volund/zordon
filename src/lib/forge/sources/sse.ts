import type { ForgeEvent } from "../types";
import type { ForgeSource } from "../source";

/**
 * DEPRECATED: SSE-based ForgeSource
 *
 * The endpoint this relied on was removed in FUI-004.
 * Use createSupabaseSource instead for Realtime-based event streaming.
 *
 * This file is kept for reference but should not be used in new code.
 */
export function createSSESource(runId: string): ForgeSource {
  const subscribers = new Set<(e: ForgeEvent) => void>();
  let eventSource: EventSource | null = null;
  let running = false;

  function emit(e: ForgeEvent) {
    for (const s of subscribers) s(e);
  }

  return {
    start() {
      if (running || eventSource) return;
      running = true;

      // DEAD CODE: endpoint removed in FUI-004
      const url = `<removed-in-FUI-004>/forge/runs/${runId}/stream-deleted`;
      eventSource = new EventSource(url);

      eventSource.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);

          // Normalize to ForgeEvent shape (SSE uses snake_case from local file)
          const forgeEvent: ForgeEvent = {
            run_id: data.runId || runId,
            seq: data.seq ?? 0,
            ts: typeof data.ts === 'string' ? new Date(data.ts).getTime() : data.ts ?? Date.now(),
            agent_id: data.agentId ?? null,
            task_id: data.taskId ?? null,
            kind: data.kind,
            payload: data.payload ?? {},
          };

          emit(forgeEvent);

          // Auto-stop on done event
          if (data.kind === 'done') {
            setTimeout(() => {
              if (eventSource) {
                eventSource.close();
                eventSource = null;
                running = false;
              }
            }, 500);
          }
        } catch (err) {
          console.error('[SSESource] Failed to parse event:', err);
        }
      };

      eventSource.onerror = (err) => {
        console.error('[SSESource] EventSource error:', err);
        if (eventSource) {
          eventSource.close();
          eventSource = null;
        }
        running = false;
      };
    },

    pause() {
      // SSE doesn't support pause/resume, but we can close the connection
      if (eventSource) {
        eventSource.close();
        eventSource = null;
      }
      running = false;
    },

    resume() {
      // Re-establish connection (will re-backfill)
      this.start();
    },

    reset() {
      if (eventSource) {
        eventSource.close();
        eventSource = null;
      }
      running = false;
    },

    setSpeed(_speed: number) {
      // No-op for SSE (live stream, no speed control)
    },

    isRunning() {
      return running;
    },

    onEvent(cb) {
      subscribers.add(cb);
      return () => subscribers.delete(cb);
    },
  };
}
