// Adapters: DB rows → sandbox component types.
// Sandbox components (StoriesList, StorySheet, TasksList, TaskSheet, etc.)
// were authored against domain types in `./types`. Real data comes from
// Supabase rows shaped differently. These functions bridge the gap so the
// production page can consume API responses with no component changes.

import type {
  AC as ACView,
  Member as MemberView,
  Module as ModuleView,
  Persona as PersonaView,
  Story as StoryView,
  Task as TaskView,
  TaskComplexity,
  TaskScope,
  TaskStatus,
  TaskTag,
  TaskType,
} from "./types";

import type {
  AcceptanceCriterionRow,
  ModuleRow,
  PersonaRow,
  StoryWithRelations,
} from "@/lib/dal/story-hierarchy";

export function adaptModule(row: ModuleRow): ModuleView {
  return {
    id: row.id,
    name: row.name,
    description: row.description ?? undefined,
  };
}

export function adaptPersona(row: PersonaRow): PersonaView {
  return {
    id: row.id,
    name: row.name,
    description: row.description ?? undefined,
  };
}

export function adaptAc(row: AcceptanceCriterionRow): ACView {
  return {
    id: row.id,
    text: row.text,
    checked: row.checkedAt !== null,
    checkedBy: row.checkedBy ?? undefined,
    checkedAt: row.checkedAt ?? undefined,
  };
}

/**
 * Sandbox `Story` keys by `reference`. We keep the DB id alongside via the
 * `__id` field for callers that need it (stories list, task creation).
 */
export type AdaptedStory = StoryView & { __id: string };

export function adaptStory(row: StoryWithRelations): AdaptedStory {
  return {
    __id: row.id,
    reference: row.reference,
    moduleId: row.moduleId,
    proposedModuleName: row.proposedModuleName ?? undefined,
    title: row.title,
    personaId: row.personaId ?? "",
    want: row.want,
    soThat: row.soThat ?? null,
    refinementStatus: row.refinementStatus as
      | "draft"
      | "refined"
      | "committed",
    acValidatedAt: row.acValidatedAt,
    acValidatedBy: row.acValidatedBy,
    acceptanceCriteria: (row.acceptanceCriteria ?? []).map(adaptAc),
    designSessionRef: row.designSessionId ?? undefined,
    createdByAgent: row.createdByAgent,
  };
}

export type AdaptedTask = TaskView & { __id: string };

/**
 * Adapt a Task DB row + its assignments + AC rows. The sandbox uses
 * `userStoryRef` (string) to point at story; we look it up from the stories
 * map. AC rows are filtered to those owned by this task.
 */
/** Subset of TaskRow shape we actually consume; permissive so callers can
 *  pass partial DB rows (e.g. when joining via a `select(...)`). */
type TaskAdapterInput = {
  id: string;
  reference: string | null;
  title: string;
  description: string | null;
  status: string;
  type: string | null;
  scope: string | null;
  complexity: string | null;
  functionPoints: number | null;
  billable: boolean | null;
  dueDate: string | null;
  doneAt: string | null;
  notes: string | null;
  sprintId: string | null;
  userStoryId: string | null;
  createdByAgent: boolean | null;
  assignments?: Array<{
    memberId?: string | null;
    member?: { id: string } | null;
  }>;
  /** Tag rows joined via `tags:TaskTagAssignment(TaskTag(*))`. */
  tags?: Array<{
    TaskTag?: { id: string; name: string; tone: string } | null;
  }>;
};

export function adaptTask(
  row: TaskAdapterInput,
  ctx: {
    storyByDbId: Map<string, AdaptedStory>;
    acByTaskId: Map<string, AcceptanceCriterionRow[]>;
  },
): AdaptedTask {
  const story = row.userStoryId
    ? ctx.storyByDbId.get(row.userStoryId)
    : null;

  const assigneeIds = (row.assignments ?? [])
    .map((a) => a.member?.id ?? a.memberId ?? null)
    .filter((id): id is string => !!id);

  const ac = (ctx.acByTaskId.get(row.id) ?? []).map(adaptAc);

  const tags: TaskTag[] = (row.tags ?? [])
    .map((j) => j.TaskTag)
    .filter((t): t is { id: string; name: string; tone: string } => Boolean(t))
    .map((t) => ({ id: t.id, name: t.name, tone: t.tone }))
    .sort((a, b) => a.name.localeCompare(b.name));

  return {
    __id: row.id,
    reference: row.reference ?? row.id,
    userStoryRef: story?.reference ?? null,
    sprintId: row.sprintId ?? null,
    title: row.title,
    description: row.description ?? null,
    status: row.status as TaskStatus,
    type: (row.type ?? "feature") as TaskType,
    scope: (row.scope ?? "small") as TaskScope,
    complexity: (row.complexity ?? "medium") as TaskComplexity,
    tags,
    functionPoints: row.functionPoints ?? 0,
    billable: row.billable ?? true,
    dueDate: row.dueDate ?? null,
    doneAt: row.doneAt ?? null,
    notes: row.notes ?? null,
    assigneeIds,
    acceptanceCriteria: ac,
    createdByAgent: row.createdByAgent ?? false,
  };
}

export type AdaptedMember = MemberView;

export function adaptMember(row: {
  id: string;
  name: string;
  role?: string | null;
}): AdaptedMember {
  return {
    id: row.id,
    name: row.name,
    role: row.role ?? undefined,
  };
}

/** Build the maps needed by `adaptTask`. */
export function buildTaskAdapterContext(
  stories: AdaptedStory[],
  acRows: AcceptanceCriterionRow[],
) {
  const storyByDbId = new Map(stories.map((s) => [s.__id, s]));
  const acByTaskId = new Map<string, AcceptanceCriterionRow[]>();
  for (const ac of acRows) {
    if (!ac.taskId) continue;
    const arr = acByTaskId.get(ac.taskId) ?? [];
    arr.push(ac);
    acByTaskId.set(ac.taskId, arr);
  }
  return { storyByDbId, acByTaskId };
}
