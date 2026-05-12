/**
 * Vocabulary for Design Session briefing flow.
 *
 * The briefing step has 4 sub-phases that drive Vitor's behavior. The string
 * value is persisted in `DesignSession.briefingSubPhase`. Keep this file as
 * the single source of truth — Zod schemas, prompt branches and UI labels all
 * derive from these constants.
 */

export const BRIEFING_SUB_PHASES = {
  /** Map product modules from brainstorm. Output: N draft modules (no stories). */
  MODULE_DISCOVERY: "module_discovery",
  /** Generate skeleton stories grouped by approved/draft modules. No AC, no tasks. */
  STORY_TREE: "story_tree",
  /** Refine ONE story: persona, want/soThat, product AC. */
  STORY_DETAIL: "story_detail",
  /** Decompose ONE refined story into technical tasks. */
  TASK_BREAKDOWN: "task_breakdown",
} as const;

export type BriefingSubPhase =
  (typeof BRIEFING_SUB_PHASES)[keyof typeof BRIEFING_SUB_PHASES];

export const BRIEFING_SUB_PHASE_VALUES = Object.values(
  BRIEFING_SUB_PHASES,
) as readonly BriefingSubPhase[];

/** Canonical order of sub-phases through the briefing flow. */
export const BRIEFING_SUB_PHASE_ORDER: readonly BriefingSubPhase[] = [
  BRIEFING_SUB_PHASES.MODULE_DISCOVERY,
  BRIEFING_SUB_PHASES.STORY_TREE,
  BRIEFING_SUB_PHASES.STORY_DETAIL,
  BRIEFING_SUB_PHASES.TASK_BREAKDOWN,
] as const;

/** PT-BR labels for UI surfaces (badges, placeholders, breadcrumbs). */
export const BRIEFING_SUB_PHASE_LABEL: Record<BriefingSubPhase, string> = {
  module_discovery: "Mapear módulos",
  story_tree: "Gerar stories",
  story_detail: "Refinar story",
  task_breakdown: "Decompor em tasks",
};

/** Default sub-phase when briefing data has nothing persisted yet. */
export const DEFAULT_BRIEFING_SUB_PHASE: BriefingSubPhase =
  BRIEFING_SUB_PHASES.MODULE_DISCOVERY;
