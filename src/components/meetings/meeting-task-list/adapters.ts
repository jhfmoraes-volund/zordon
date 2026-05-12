// Adapters that bridge MeetingTaskAction → row shape used by MeetingTaskList.
//
// Each row carries the original action plus a "Task" view of what the row
// should display:
//   - create: virtual task built from payload; reference null
//   - update: real task with payload diff applied; changedFields highlights cols
//   - move:   real task; targetSprintId surfaces in the Sprint column as "→ N"
//   - delete: real task with the strikethrough flag set
//   - review: real task; no diff
//
// The adapter never mutates the underlying RawTask — it copies into the
// story-hierarchy Task shape so MeetingTaskList can render with the same
// primitives as TasksList (chips, tag display, member lookup).

import type {
  AC,
  Story,
  Task,
  TaskComplexity,
  TaskScope,
  TaskStatus,
  TaskTag,
  TaskType,
} from "@/components/story-hierarchy";
import type { MeetingTaskAction } from "../meeting-task-action-sheet";

// What the widget already loads about "real" tasks. Keep loose to allow
// progressive enrichment without breaking the adapter.
export type RawTaskForRow = {
  id: string;
  reference: string | null;
  title: string;
  description: string | null;
  status: TaskStatus | string;
  type: TaskType | string;
  scope: TaskScope | string;
  complexity: TaskComplexity | string;
  priority: number;
  sprintId: string | null;
  userStoryId: string | null;
  functionPoints: number | null;
  billable: boolean | null;
  dueDate: string | null;
  notes: string | null;
  assignments?: { memberId: string }[];
  /** Flat tag list — embed rows must be flattened via `flattenTagEmbed`
   *  at the data-fetching boundary before being passed here. */
  tags?: TaskTag[];
};

export type RowTask = Task & { __id: string | null };

export type ActionRow = {
  action: MeetingTaskAction;
  /** Task shape ready to render. May be virtual (create) or real with diff. */
  task: RowTask;
  /** Sprint id the row should display in the Sprint column (post-action). */
  displaySprintId: string | null;
  /** For "move", the original sprint so callers can render `current → target`. */
  originalSprintId: string | null;
  /** Set of fields that visually changed from the underlying task. Empty unless update. */
  changedFields: Set<keyof Task>;
  /** True for delete actions — caller may render strikethrough. */
  strikethrough: boolean;
};

const VIRTUAL_REF = "—"; // placeholder shown for create rows

function rawToTask(raw: RawTaskForRow, storyRefById: Map<string, string>): RowTask {
  const tags: TaskTag[] = raw.tags ?? [];
  return {
    __id: raw.id,
    reference: raw.reference ?? VIRTUAL_REF,
    userStoryRef: raw.userStoryId ? storyRefById.get(raw.userStoryId) ?? null : null,
    sprintId: raw.sprintId,
    title: raw.title,
    description: raw.description,
    status: (raw.status as TaskStatus) ?? "backlog",
    type: (raw.type as TaskType) ?? "feature",
    scope: (raw.scope as TaskScope) ?? "small",
    complexity: (raw.complexity as TaskComplexity) ?? "medium",
    tags,
    functionPoints: raw.functionPoints ?? 0,
    billable: raw.billable ?? true,
    dueDate: raw.dueDate,
    doneAt: null,
    notes: raw.notes,
    assigneeIds: (raw.assignments ?? []).map((a) => a.memberId),
    acceptanceCriteria: [],
    createdByAgent: false,
  };
}

function virtualTaskFromCreate(
  payload: Record<string, unknown>,
  storyRefById: Map<string, string>,
  availableTags: TaskTag[],
): RowTask {
  const tagIds = Array.isArray(payload.tagIds) ? (payload.tagIds as string[]) : [];
  const tags = availableTags.filter((t) => tagIds.includes(t.id));

  const userStoryId = (payload.userStoryId as string | null | undefined) ?? null;

  const acs = Array.isArray(payload.acceptanceCriteria)
    ? (payload.acceptanceCriteria as Array<{ text: string }>)
    : [];

  return {
    __id: null,
    reference: VIRTUAL_REF,
    userStoryRef: userStoryId ? storyRefById.get(userStoryId) ?? null : null,
    sprintId: (payload.sprintId as string | null | undefined) ?? null,
    title: (payload.title as string) ?? "Nova task",
    description: (payload.description as string | null | undefined) ?? null,
    status: ((payload.status as TaskStatus | undefined) ?? "backlog"),
    type: ((payload.type as TaskType | undefined) ?? "feature"),
    scope: ((payload.scope as TaskScope | undefined) ?? "small"),
    complexity: ((payload.complexity as TaskComplexity | undefined) ?? "medium"),
    tags,
    functionPoints: (payload.functionPoints as number | undefined) ?? 0,
    billable: (payload.billable as boolean | undefined) ?? true,
    dueDate: (payload.dueDate as string | null | undefined) ?? null,
    doneAt: null,
    notes: (payload.notes as string | null | undefined) ?? null,
    assigneeIds: Array.isArray(payload.assigneeIds) ? (payload.assigneeIds as string[]) : [],
    acceptanceCriteria: acs.map<AC>((a, i) => ({
      id: `ac-virt-${i}`,
      text: a.text,
      checked: false,
    })),
    createdByAgent: true,
  };
}

/**
 * Apply payload patch on top of base task. Returns the merged task plus the
 * set of changed fields (compared to base).
 */
function applyUpdatePatch(
  base: RowTask,
  payload: Record<string, unknown>,
  storyRefById: Map<string, string>,
  availableTags: TaskTag[],
): { task: RowTask; changedFields: Set<keyof Task> } {
  const next: RowTask = { ...base };
  const changed = new Set<keyof Task>();

  const setIf = (key: keyof Task, value: unknown) => {
    if ((next as Record<string, unknown>)[key] !== value) {
      (next as Record<string, unknown>)[key] = value;
      changed.add(key);
    }
  };

  if ("title" in payload) setIf("title", payload.title);
  if ("description" in payload) setIf("description", payload.description);
  if ("status" in payload) setIf("status", payload.status);
  if ("type" in payload) setIf("type", payload.type);
  if ("scope" in payload) setIf("scope", payload.scope);
  if ("complexity" in payload) setIf("complexity", payload.complexity);
  if ("functionPoints" in payload) setIf("functionPoints", (payload.functionPoints as number) ?? 0);
  if ("billable" in payload) setIf("billable", (payload.billable as boolean) ?? true);
  if ("dueDate" in payload) setIf("dueDate", payload.dueDate);
  if ("notes" in payload) setIf("notes", payload.notes);
  if ("sprintId" in payload) setIf("sprintId", payload.sprintId);

  if ("userStoryId" in payload) {
    const ref = payload.userStoryId
      ? storyRefById.get(payload.userStoryId as string) ?? null
      : null;
    if (next.userStoryRef !== ref) {
      next.userStoryRef = ref;
      changed.add("userStoryRef");
    }
  }

  if (Array.isArray(payload.assigneeIds)) {
    const ids = payload.assigneeIds as string[];
    const same =
      ids.length === next.assigneeIds.length &&
      ids.every((id, i) => next.assigneeIds[i] === id);
    if (!same) {
      next.assigneeIds = ids;
      changed.add("assigneeIds");
    }
  }

  if (Array.isArray(payload.tagIds)) {
    const ids = payload.tagIds as string[];
    const tags = availableTags.filter((t) => ids.includes(t.id));
    next.tags = tags;
    changed.add("tags");
  }

  return { task: next, changedFields: changed };
}

export function actionToRow(
  action: MeetingTaskAction,
  raw: RawTaskForRow | null,
  storyRefById: Map<string, string>,
  availableTags: TaskTag[],
): ActionRow {
  const payload = (action.payload ?? {}) as Record<string, unknown>;

  if (action.type === "create") {
    const task = virtualTaskFromCreate(payload, storyRefById, availableTags);
    return {
      action,
      task,
      displaySprintId: task.sprintId ?? null,
      originalSprintId: null,
      changedFields: new Set(),
      strikethrough: false,
    };
  }

  // update/move/delete/review all need an underlying task
  if (!raw) {
    // task got deleted between creating the action and rendering; show stub
    const stub: Task & { __id: null } = {
      __id: null,
      reference: action.taskId?.slice(0, 6) ?? VIRTUAL_REF,
      userStoryRef: null,
      sprintId: null,
      title: "(task removida)",
      description: null,
      status: "backlog",
      type: "feature",
      scope: "small",
      complexity: "medium",
      tags: [],
      functionPoints: 0,
      billable: true,
      dueDate: null,
      doneAt: null,
      notes: null,
      assigneeIds: [],
      acceptanceCriteria: [],
      createdByAgent: false,
    };
    return {
      action,
      task: stub,
      displaySprintId: null,
      originalSprintId: null,
      changedFields: new Set(),
      strikethrough: action.type === "delete",
    };
  }

  const base = rawToTask(raw, storyRefById);

  if (action.type === "update") {
    const { task, changedFields } = applyUpdatePatch(base, payload, storyRefById, availableTags);
    return {
      action,
      task,
      displaySprintId: task.sprintId ?? null,
      originalSprintId: base.sprintId ?? null,
      changedFields,
      strikethrough: false,
    };
  }

  if (action.type === "move") {
    return {
      action,
      task: base,
      displaySprintId: action.targetSprintId,
      originalSprintId: base.sprintId ?? null,
      changedFields: new Set(),
      strikethrough: false,
    };
  }

  // delete or review — show base task, optional strikethrough for delete
  return {
    action,
    task: base,
    displaySprintId: base.sprintId ?? null,
    originalSprintId: base.sprintId ?? null,
    changedFields: new Set(),
    strikethrough: action.type === "delete",
  };
}

export function buildStoryRefMap(stories: Array<Story & { __id?: string }>): Map<string, string> {
  const m = new Map<string, string>();
  for (const s of stories) {
    if (s.__id) m.set(s.__id, s.reference);
  }
  return m;
}
