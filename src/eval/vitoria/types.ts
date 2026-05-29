/**
 * Eval suite types — one scenario = one behavior we want Vitoria to exhibit
 * across a planning ceremony. See README.md for context.
 *
 * Mirrors src/eval/vitor/types.ts shape so the harness vocabulary stays
 * consistent across our two agents.
 */

export type ConfidenceLabel = "hard_fact" | "inferred" | "assumption" | "metadata_only";

export interface DecisionFixture {
  id: string;
  statement: string;
  rationale: string;
  status: "active" | "under_review" | "reverted";
  confidence: "hard_fact" | "inferred" | "assumption";
  tags?: string[];
  createdAt: string;
}

export interface OpenQuestionFixture {
  id: string;
  question: string;
  blocksWhat?: string;
  status: "open" | "answered" | "obsolete";
  createdAt: string;
}

export interface TranscriptFixture {
  id: string;
  title: string;
  capturedAt: string;
  /** Raw transcript text. Speaker prefixes optional. */
  fullText: string;
  /** Approx duration in minutes — used by cases that simulate "long" transcripts. */
  durationMinutes?: number;
}

export interface SpreadsheetFixture {
  id: string;
  title: string;
  /**
   * Markdown table or CSV string. Reader (G1) normalizes both.
   * Seed maps this to a TranscriptRef row with source='spreadsheet' +
   * storagePath in the 'planning-sources' bucket (per migration
   * 20260530_transcript_ref_spreadsheet). The agent reads via
   * read_transcript_content — the existing tool already covers it.
   */
  content: string;
  /** Hint for sanity checks (e.g. "total OKRs = 12"). */
  knownTotals?: Record<string, number>;
}

export interface ContextNoteFixture {
  id: string;
  kind:
    | "summary"
    | "theme"
    | "risk"
    | "capacity_signal"
    | "code_observation"
    | "open_question"
    | "scope_creep";
  content: string;
  priority?: number;
}

export interface SprintFixture {
  id: string;
  name: string;
  startDate: string;
  endDate: string;
  status: "planned" | "active" | "completed";
  /** Tasks already in the sprint (used by capacity cases). */
  capacityFp: number;
  committedFp: number;
}

export interface PendingActionFixture {
  id: string;
  type: "create" | "update" | "delete" | "move";
  taskId?: string;
  targetSprintId?: string;
  payload: Record<string, unknown>;
  aiReasoning: string;
  aiConfidence: number;
}

export interface PlanningSetup {
  /** Planning phase when the conversation starts. */
  phase: "open" | "in_review" | "ready_to_commit" | "closed";
  /** Project-level fixtures Vitoria can read from loadContext. */
  project: {
    name: string;
    memoryMd?: string;
    activeDecisions?: DecisionFixture[];
    openQuestions?: OpenQuestionFixture[];
    /**
     * Closed sprints with outcome ratios — needed by case-10 forecast.
     * Each entry is `{ plannedFp, deliveredFp }`.
     */
    sprintHistory?: { plannedFp: number; deliveredFp: number }[];
  };
  /** Sprint targeted by this planning (capacity gate scope). */
  sprint?: SprintFixture;
  /** Linked transcripts (one or more). */
  transcripts?: TranscriptFixture[];
  /** Linked spreadsheets / attachments. */
  spreadsheets?: SpreadsheetFixture[];
  /** Context notes already in the briefing. */
  notes?: ContextNoteFixture[];
  /** MeetingTaskAction rows already proposed and pending decision. */
  pendingActions?: PendingActionFixture[];
}

export interface Turn {
  role: "user";
  content: string;
}

export interface ToolCallExpectation {
  name: string;
  /** Partial arg match — assertion fails if any specified arg doesn't match. */
  args?: Record<string, unknown>;
  /** If true, this tool call must NOT happen (negative assertion). */
  forbidden?: boolean;
}

export interface Expected {
  toolCalls?: ToolCallExpectation[];
  responseContains?: string[];
  responseNotContains?: string[];
  /** Free-form behavioral check evaluated by an LLM judge (rubric, not wired in v1). */
  judgeRubric?: string;
}

/**
 * Phase dependency follows the vitoria-v2 runbook:
 *   0 = should already work today (uses only G0 wiring).
 *   1 = needs G1 source readers + PlanningSourceCache.
 *   2 = needs G2 skill catalog.
 *   3 = needs G3 capacity gate as hard block.
 *   4 = needs G4 conflict detector.
 *   5 = needs G5 task drafter + confidence/provenance Zod.
 *   6 = needs G6 sprint forecaster + SprintOutcome.
 *   7 = needs G7 outcome reflector + cross-agent active.
 */
export type PhaseDependency = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7;

export interface EvalScenario {
  /** Stable kebab-case id. */
  name: string;
  /** Human-readable title. */
  title: string;
  /** What this scenario asserts. */
  description: string;
  phaseDependency: PhaseDependency;
  /** True if this scenario can run against current Vitoria without future phases. */
  runnableToday: boolean;
  /** Predicted outcome against the current Vitoria (pre-v2). Written by hand. */
  baselinePrediction: "pass" | "partial" | "fail";
  baselineRationale: string;

  setup: PlanningSetup;
  turns: Turn[];
  expected: Expected;
}

export interface ScenarioResult {
  scenarioName: string;
  status: "pass" | "fail" | "partial" | "skipped" | "error";
  reason: string;
  toolCalls: { name: string; args: unknown }[];
  responseText: string;
  failures: string[];
}
