import { db } from "../../db";

/**
 * ForgeRun lifecycle helpers — idempotent UPDATE operations.
 *
 * Each helper mutates exactly one aspect of the ForgeRun lifecycle:
 * - markRunRunning: queued → running (sets startedAt)
 * - updateRunProgress: increments progress counter (0-100)
 * - markRunDone: running → done (sets endedAt, populates meta)
 * - markRunError: * → error (sets endedAt, populates meta.errorReason)
 *
 * All UPDATEs include idempotency guards (WHERE status NOT IN ('done','error'))
 * to prevent overwriting terminal states.
 */

/**
 * Transition: queued → running.
 * Sets startedAt to now().
 * Idempotent: only updates if status='queued'.
 */
export async function markRunRunning(runId: string): Promise<void> {
  const { error } = await db()
    .from("ForgeRun")
    .update({ status: "running", startedAt: new Date().toISOString() })
    .eq("id", runId)
    .eq("status", "queued");

  if (error) {
    console.warn(`[run-state] markRunRunning(${runId}) failed:`, error);
  }
}

/**
 * Update progress counter based on stories passed.
 * progress = floor((storiesPassed / totalStories) * 100), clamped [0, 100].
 * Idempotent: only updates if status NOT IN ('done','error').
 */
export async function updateRunProgress(
  runId: string,
  storiesPassed: number,
  totalStories: number
): Promise<void> {
  const progress = Math.min(
    100,
    Math.max(0, Math.floor((storiesPassed / totalStories) * 100))
  );

  const { error } = await db()
    .from("ForgeRun")
    .update({ progress })
    .eq("id", runId)
    .not("status", "in", '("done","error")');

  if (error) {
    console.warn(`[run-state] updateRunProgress(${runId}) failed:`, error);
  }
}

/**
 * Transition: * → done.
 * Sets endedAt, progress=100, meta.reason, meta.eventCounts.
 * Idempotent: only updates if status NOT IN ('done','error').
 */
export async function markRunDone(
  runId: string,
  reason: "all_passed" | "max_reached" | "no_more_ready"
): Promise<void> {
  // Get event counts for this run
  const { data: events } = await db()
    .from("ForgeEvent")
    .select("kind")
    .eq("runId", runId);

  const eventCounts: Record<string, number> = {};
  for (const e of events ?? []) {
    eventCounts[e.kind] = (eventCounts[e.kind] ?? 0) + 1;
  }

  // Update ForgeRun with done state
  const { error } = await db()
    .from("ForgeRun")
    .update({
      status: "done",
      endedAt: new Date().toISOString(),
      progress: 100,
      meta: {
        reason,
        eventCounts,
      } as never,
    })
    .eq("id", runId)
    .not("status", "in", '("done","error")');

  if (error) {
    console.warn(`[run-state] markRunDone(${runId}) failed:`, error);
  }
}

/**
 * Transition: * → error.
 * Sets endedAt, meta.errorReason.
 * Idempotent: only updates if status NOT IN ('done','error').
 */
export async function markRunError(
  runId: string,
  errorReason:
    | "story_failed"
    | "pivot_required"
    | "crash"
    | "no_prd_json"
    | "no_forge_run"
): Promise<void> {
  // Get event counts for this run (same as markRunDone)
  const { data: events } = await db()
    .from("ForgeEvent")
    .select("kind")
    .eq("runId", runId);

  const eventCounts: Record<string, number> = {};
  for (const e of events ?? []) {
    eventCounts[e.kind] = (eventCounts[e.kind] ?? 0) + 1;
  }

  const { error } = await db()
    .from("ForgeRun")
    .update({
      status: "error",
      endedAt: new Date().toISOString(),
      meta: {
        errorReason,
        eventCounts,
      } as never,
    })
    .eq("id", runId)
    .not("status", "in", '("done","error")');

  if (error) {
    console.warn(`[run-state] markRunError(${runId}) failed:`, error);
  }
}
