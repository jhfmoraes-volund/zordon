import type { ForgeEvent } from "../types";
import type { ForgeSource } from "../source";
import { createClient } from "@supabase/supabase-js";
import type { RealtimeChannel } from "@supabase/supabase-js";

/**
 * Supabase Realtime ForgeSource — subscribes to postgres_changes on ForgeEvent table
 *
 * Backfills existing events on start, then listens for new INSERTs via realtime.
 * Falls back to this when SSE is unavailable (wifi off, local dev not running).
 */
export function createSupabaseSource(runId: string): ForgeSource {
  const subscribers = new Set<(e: ForgeEvent) => void>();
  let channel: RealtimeChannel | null = null;
  let running = false;
  let lastSeq = 0;

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
  const supabase = createClient(supabaseUrl, supabaseAnonKey);

  function emit(e: ForgeEvent) {
    for (const s of subscribers) s(e);
  }

  async function backfill() {
    try {
      const { data, error } = await supabase
        .from("ForgeEvent")
        .select("*")
        .eq("runId", runId)
        .order("seq", { ascending: true })
        .limit(1000);

      if (error) {
        console.error("[SupabaseSource] Backfill error:", error);
        return;
      }

      if (data) {
        for (const row of data) {
          const event: ForgeEvent = {
            run_id: row.runId,
            seq: Number(row.seq),
            ts: new Date(row.ts).getTime(),
            agent_id: row.agentId,
            task_id: row.taskId,
            kind: row.kind as ForgeEvent["kind"],
            payload: (row.payload as Record<string, unknown>) ?? {},
          };
          emit(event);
          lastSeq = Math.max(lastSeq, event.seq);
        }
      }
    } catch (err) {
      console.error("[SupabaseSource] Backfill exception:", err);
    }
  }

  return {
    start() {
      if (running || channel) return;
      running = true;

      // Backfill existing events first
      void backfill().then(() => {
        // Subscribe to new events
        channel = supabase.channel(`forge-run-${runId}`);

        channel
          .on(
            "postgres_changes",
            {
              event: "INSERT",
              schema: "public",
              table: "ForgeEvent",
              filter: `runId=eq.${runId}`,
            },
            (payload) => {
              try {
                const row = payload.new;
                const seq = Number(row.seq);

                // Dedup: skip if we already processed this seq
                if (seq <= lastSeq) return;
                lastSeq = seq;

                const event: ForgeEvent = {
                  run_id: row.runId,
                  seq,
                  ts: new Date(row.ts).getTime(),
                  agent_id: row.agentId,
                  task_id: row.taskId,
                  kind: row.kind as ForgeEvent["kind"],
                  payload: (row.payload as Record<string, unknown>) ?? {},
                };

                emit(event);

                // Auto-stop on done event
                if (event.kind === "done") {
                  setTimeout(() => {
                    if (channel) {
                      void channel.unsubscribe();
                      channel = null;
                    }
                    running = false;
                  }, 500);
                }
              } catch (err) {
                console.error("[SupabaseSource] Failed to process realtime event:", err);
              }
            }
          )
          .subscribe((status) => {
            if (status === "SUBSCRIBED") {
              console.log(`[SupabaseSource] Subscribed to run ${runId}`);
            } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
              console.error(`[SupabaseSource] Subscription error: ${status}`);
              running = false;
            }
          });
      });
    },

    pause() {
      if (channel) {
        void channel.unsubscribe();
        channel = null;
      }
      running = false;
    },

    resume() {
      this.start();
    },

    reset() {
      if (channel) {
        void channel.unsubscribe();
        channel = null;
      }
      running = false;
      lastSeq = 0;
    },

    setSpeed(_speed: number) {
      // No-op for realtime (live stream, no speed control)
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
