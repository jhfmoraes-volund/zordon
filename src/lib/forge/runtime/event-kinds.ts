/**
 * Canonical taxonomy of ForgeEvent kinds emitted by the Forge runtime.
 *
 * This is the living documentation of event kinds — the source of truth
 * lives in code, not in a database CHECK constraint.
 *
 * ForgeEvent.kind in the database is free-form text (no CHECK constraint),
 * but this type provides IDE autocomplete and compile-time safety for
 * the event emitter and consumers.
 */
export type ForgeEventKind =
  // Orchestrator lifecycle
  | "autorun_started"
  | "autorun_done"
  | "manifest_bootstrapped"

  // Story lifecycle
  | "story_picked"
  | "story_running"
  | "story_done"
  | "story_failed"
  | "story_spawn_error"

  // PRD state transitions
  | "prd_state_change"

  // Error events
  | "error"

  // Claude SDK events (from exec-story.ts)
  | "tool_use"
  | "tool_result"
  | "assistant_text"
  | "stderr"
  | "claude_system"
  | "claude_result"
  | "claude_closed"

  // Final event
  | "done";
