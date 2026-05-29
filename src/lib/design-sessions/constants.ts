/**
 * Vocabulary for Design Session briefing flow.
 *
 * The briefing step has 4 sub-phases that drive Vitor's behavior. The string
 * value is persisted in `DesignSession.briefingSubPhase`. Keep this file as
 * the single source of truth — Zod schemas, prompt branches and UI labels all
 * derive from these constants.
 */

export const BRIEFING_SUB_PHASES = {
  /** Map product modules from brainstorm. Output: N draft modules (no PRDs). */
  MODULE_DISCOVERY: "module_discovery",
  /** Draft PRDs for each functionality identified in brainstorm. One PRD per feature/functionality. */
  PRD_DRAFTING: "prd_drafting",
  /** Review and approve PRDs. Terminal sub-phase — step completes when all PRDs approved. */
  PRD_REVIEW: "prd_review",
} as const;

export type BriefingSubPhase =
  (typeof BRIEFING_SUB_PHASES)[keyof typeof BRIEFING_SUB_PHASES];

export const BRIEFING_SUB_PHASE_VALUES = Object.values(
  BRIEFING_SUB_PHASES,
) as readonly BriefingSubPhase[];

/** Canonical order of sub-phases through the briefing flow. */
export const BRIEFING_SUB_PHASE_ORDER: readonly BriefingSubPhase[] = [
  BRIEFING_SUB_PHASES.MODULE_DISCOVERY,
  BRIEFING_SUB_PHASES.PRD_DRAFTING,
  BRIEFING_SUB_PHASES.PRD_REVIEW,
] as const;

/** PT-BR labels for UI surfaces (badges, placeholders, breadcrumbs). */
export const BRIEFING_SUB_PHASE_LABEL: Record<BriefingSubPhase, string> = {
  module_discovery: "Mapear módulos",
  prd_drafting: "Rascunhar PRDs",
  prd_review: "Revisar PRDs",
};

/** Default sub-phase when briefing data has nothing persisted yet. */
export const DEFAULT_BRIEFING_SUB_PHASE: BriefingSubPhase =
  BRIEFING_SUB_PHASES.MODULE_DISCOVERY;
