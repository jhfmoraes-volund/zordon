// Domain types for the Module → UserStory → Task hierarchy.
// Mirror the schema-alvo in `docs/story-hierarchy-plan.md` (V2).
//
// Mock data and real fetched data both conform to these — the components in
// this folder don't care about the source.

export type Persona = {
  id: string;
  name: string;
  description?: string;
};

export type Module = {
  id: string;
  name: string;
  description?: string;
};

export type AC = {
  id: string;
  text: string;
  checked: boolean;
  checkedBy?: string;
  checkedAt?: string;
};

export type Member = {
  id: string;
  name: string;
  role?: string;
  isPm?: boolean;
  isBuilder?: boolean;
};

// ─── Task ────────────────────────────────────────────────────────────────────

export type TaskStatus =
  | "draft"
  | "backlog"
  | "todo"
  | "in_progress"
  | "review"
  | "done";

export type TaskType =
  | "feature"
  | "bugfix"
  | "refactor"
  | "setup"
  | "component"
  | "seed"
  | "management";

export type TaskScope = "micro" | "small" | "medium" | "large";
export type TaskComplexity = "trivial" | "low" | "medium" | "high";

export type TaskTag = {
  id: string;
  name: string;
  tone: string;
};

export type Task = {
  reference: string;
  userStoryRef: string | null;
  sprintId?: string | null;
  title: string;
  description?: string | null;
  status: TaskStatus;
  type: TaskType;
  scope: TaskScope;
  complexity: TaskComplexity;
  tags: TaskTag[];
  functionPoints: number;
  billable: boolean;
  dueDate?: string | null;
  /** ISO timestamp of when status transitioned to done. Drives burndown. */
  doneAt?: string | null;
  notes?: string | null;
  assigneeIds: string[];
  acceptanceCriteria: AC[];
  createdByAgent: boolean;
};

// ─── Story ───────────────────────────────────────────────────────────────────

export type RefinementStatus = "draft" | "refined" | "committed";
export type ComputedStatus =
  | "pending"
  | "in_progress"
  | "tasks_complete"
  | "done";

export type Story = {
  reference: string;
  moduleId: string | null;
  proposedModuleName?: string;
  title: string;
  personaId: string;
  want: string;
  soThat: string | null;
  refinementStatus: RefinementStatus;
  acValidatedAt: string | null;
  acValidatedBy: string | null;
  acceptanceCriteria: AC[];
  designSessionRef?: string;
  createdByAgent: boolean;
};

// ─── Project context ─────────────────────────────────────────────────────────

export type ProjectContext = {
  name: string;
  referenceKey: string;
  definitionOfDone: string[];
};
