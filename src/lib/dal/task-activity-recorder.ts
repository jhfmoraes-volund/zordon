import "server-only";
import { getActorMemberId } from "@/lib/dal";
import { createActivity, type TaskActivityType } from "@/lib/dal/task-activity";
import type {
  AcSnapshot,
  TaskRow,
  TaskSnapshot,
} from "@/lib/dal/task-snapshot";

type EventInput = {
  type: TaskActivityType;
  payload: Record<string, unknown>;
};

const SCALAR_FIELDS = [
  ["status", "status_changed"],
  ["sprintId", "sprint_changed"],
  ["userStoryId", "story_changed"],
  ["functionPoints", "fp_changed"],
  ["scope", "scope_changed"],
  ["complexity", "complexity_changed"],
  ["type", "type_changed"],
  ["title", "title_edited"],
  ["description", "description_edited"],
] as const satisfies ReadonlyArray<[keyof TaskRow, TaskActivityType]>;

function diffSets(before: string[], after: string[]) {
  const beforeSet = new Set(before);
  const afterSet = new Set(after);
  const added = after.filter((id) => !beforeSet.has(id));
  const removed = before.filter((id) => !afterSet.has(id));
  return { added, removed };
}

function buildScalarEvents(
  before: TaskRow,
  after: TaskRow,
): EventInput[] {
  const out: EventInput[] = [];
  for (const [field, type] of SCALAR_FIELDS) {
    const b = before[field];
    const a = after[field];
    if (b === a) continue;
    const bothNullish = (b == null || b === "") && (a == null || a === "");
    if (bothNullish) continue;
    out.push({ type, payload: { before: b ?? null, after: a ?? null } });
  }
  return out;
}

function buildAssigneesEvent(
  before: string[],
  after: string[],
): EventInput | null {
  const { added, removed } = diffSets(before, after);
  if (added.length === 0 && removed.length === 0) return null;
  return {
    type: "assignees_changed",
    payload: { added, removed, before, after },
  };
}

function buildTagsEvent(
  before: string[],
  after: string[],
): EventInput | null {
  const { added, removed } = diffSets(before, after);
  if (added.length === 0 && removed.length === 0) return null;
  return {
    type: "tags_changed",
    payload: { added, removed, before, after },
  };
}

export function diffTaskSnapshot(
  before: TaskSnapshot,
  after: TaskSnapshot,
): EventInput[] {
  const events: EventInput[] = [];
  events.push(...buildScalarEvents(before.task, after.task));
  const assignees = buildAssigneesEvent(before.assigneeIds, after.assigneeIds);
  if (assignees) events.push(assignees);
  const tags = buildTagsEvent(before.tagIds, after.tagIds);
  if (tags) events.push(tags);
  return events;
}

export type AcDiff = {
  added: { id: string; text: string }[];
  removed: { id: string; text: string }[];
  checked: { id: string; text: string }[];
  unchecked: { id: string; text: string }[];
  edited: { id: string; before: string; after: string }[];
};

export function diffAcceptance(
  before: AcSnapshot,
  after: AcSnapshot,
): AcDiff {
  const out: AcDiff = {
    added: [],
    removed: [],
    checked: [],
    unchecked: [],
    edited: [],
  };
  const beforeIds = new Set(Object.keys(before.byId));
  const afterIds = new Set(Object.keys(after.byId));
  for (const id of afterIds) {
    if (!beforeIds.has(id)) {
      out.added.push({ id, text: after.byId[id].text });
    }
  }
  for (const id of beforeIds) {
    if (!afterIds.has(id)) {
      out.removed.push({ id, text: before.byId[id].text });
    }
  }
  for (const id of afterIds) {
    const b = before.byId[id];
    const a = after.byId[id];
    if (!b) continue;
    const wasChecked = !!b.checkedAt;
    const isChecked = !!a.checkedAt;
    if (wasChecked !== isChecked) {
      (isChecked ? out.checked : out.unchecked).push({ id, text: a.text });
    }
    if (b.text !== a.text) {
      out.edited.push({ id, before: b.text, after: a.text });
    }
  }
  return out;
}

export function isAcDiffEmpty(diff: AcDiff): boolean {
  return (
    diff.added.length === 0 &&
    diff.removed.length === 0 &&
    diff.checked.length === 0 &&
    diff.unchecked.length === 0 &&
    diff.edited.length === 0
  );
}

async function emit(
  taskId: string,
  events: EventInput[],
  actorMemberId: string | null,
): Promise<void> {
  for (const ev of events) {
    try {
      await createActivity({
        taskId,
        type: ev.type,
        payload: ev.payload,
        actorMemberId,
      });
    } catch (e) {
      console.error("[task-activity] emit failed", { type: ev.type, error: e });
    }
  }
}

/**
 * Diff before/after snapshots and emit one activity per changed field.
 * Reads actor internally — never receives it. Best-effort: failures log + continue.
 */
export async function recordTaskChanges(
  taskId: string,
  before: TaskSnapshot,
  after: TaskSnapshot,
): Promise<void> {
  const events = diffTaskSnapshot(before, after);
  if (events.length === 0) return;
  const actor = await getActorMemberId().catch(() => null);
  await emit(taskId, events, actor);
}

export async function recordTaskCreated(
  taskId: string,
  payload: { title: string; reference: string | null },
): Promise<void> {
  const actor = await getActorMemberId().catch(() => null);
  await emit(
    taskId,
    [{ type: "created", payload: { ...payload } }],
    actor,
  );
}

export async function recordAcceptanceChanges(
  taskId: string,
  diff: AcDiff,
): Promise<void> {
  if (isAcDiffEmpty(diff)) return;
  const actor = await getActorMemberId().catch(() => null);
  await emit(
    taskId,
    [
      {
        type: "ac_bulk_changed",
        payload: {
          added: diff.added,
          removed: diff.removed,
          checked: diff.checked,
          unchecked: diff.unchecked,
          edited: diff.edited,
        },
      },
    ],
    actor,
  );
}
