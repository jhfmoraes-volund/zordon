/**
 * Eval suite types — one case = one behavior we want Vitor to exhibit.
 * See README.md for context.
 */

export type ConfidenceLabel = "hard_fact" | "inferred" | "assumption";

export interface DecisionFixture {
  id: string;
  statement: string;
  rationale: string;
  status: "active" | "under_review" | "reverted";
  confidence: ConfidenceLabel;
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

export interface ResearchFixture {
  id: string;
  query: string;
  summary: string;
  sources: { title: string; url: string; snippet?: string }[];
  createdAt: string;
}

export interface BusinessContextFixture {
  businessModel?: string;
  stage?: string;
  icp?: string;
  ticketRangeBrl?: [number, number];
  runwayMonths?: number;
  competitors?: { name: string; role: "reference" | "antiPattern" }[];
}

export interface SessionFixture {
  id: string;
  title: string;
  type: "inception" | "continuous_improvement" | "sprint_planning";
  status: "draft" | "in_progress" | "completed";
  memoryMd?: string;
  memoryAbstract?: string;
  stepData?: Record<string, Record<string, unknown>>;
}

export interface ProjectFixture {
  memoryMd?: string;
  businessContext?: BusinessContextFixture;
  otherSessions?: SessionFixture[];
}

export interface Setup {
  /** Step the user is currently on when conversation starts */
  currentStepKey: string;
  /** The session being run */
  session: SessionFixture;
  /** Project-level fixtures */
  project?: ProjectFixture;
  /** Active decisions seeded for this case */
  decisions?: DecisionFixture[];
  /** Open questions seeded */
  openQuestions?: OpenQuestionFixture[];
  /** Research log seeded */
  research?: ResearchFixture[];
}

export interface Turn {
  role: "user";
  content: string;
}

export interface ToolCallExpectation {
  name: string;
  /** Partial arg match — assertion fails if any specified arg doesn't match */
  args?: Record<string, unknown>;
  /** If true, this tool call must NOT happen (negative assertion) */
  forbidden?: boolean;
}

export interface Expected {
  /** Tool calls that must (or must not) appear */
  toolCalls?: ToolCallExpectation[];
  /** Substrings that must appear in any assistant response across the run */
  responseContains?: string[];
  /** Substrings that must NOT appear */
  responseNotContains?: string[];
  /** Free-form behavioral check evaluated by an LLM judge */
  judgeRubric?: string;
}

export interface EvalCase {
  /** Stable kebab-case id */
  name: string;
  /** 1-10, matches the categories in vitor-memory-plan.md */
  category: number;
  /** Short human-readable title */
  title: string;
  /** What this case asserts */
  description: string;
  /**
   * Which phase of the plan implements the structure this test depends on.
   * 0 = should already work today.
   * 1 = needs migrations + research log.
   * 2 = needs decisions/open-questions/memory tools.
   * 3 = needs mvp_check.
   * 4 = needs cross-session + auto-compact.
   */
  phaseDependency: 0 | 1 | 2 | 3 | 4;
  /** True if this can be run against current Vitor without any plan work */
  runnableToday: boolean;
  /** Predicted current Vitor outcome — written by hand for baseline */
  baselinePrediction: "pass" | "partial" | "fail";
  baselineRationale: string;

  setup: Setup;
  turns: Turn[];
  expected: Expected;
}

export interface CaseResult {
  caseName: string;
  status: "pass" | "fail" | "partial" | "skipped" | "error";
  reason: string;
  toolCalls: { name: string; args: unknown }[];
  responseText: string;
  failures: string[];
}
