import "server-only";
import { db } from "@/lib/db";
import type { Database } from "@/lib/supabase/database.types";
import type { ChipTone } from "@/lib/status-chips";
import { TAG_NAME_MAX, TASK_TAG_LIMIT, TAG_TONES } from "@/lib/task-tags";

type Tables = Database["public"]["Tables"];
type TaskTagRow = Tables["TaskTag"]["Row"];

export type TaskTag = {
  id: string;
  projectId: string;
  name: string;
  tone: ChipTone;
};

function normalizeTone(t: string): ChipTone {
  return (TAG_TONES as readonly string[]).includes(t)
    ? (t as ChipTone)
    : "muted";
}

function toTag(row: TaskTagRow): TaskTag {
  return {
    id: row.id,
    projectId: row.projectId,
    name: row.name,
    tone: normalizeTone(row.tone),
  };
}

function validateName(raw: string): string {
  const name = raw.trim();
  if (name.length === 0) throw new Error("Tag name cannot be empty");
  if (name.length > TAG_NAME_MAX) {
    throw new Error(`Tag name max length is ${TAG_NAME_MAX}`);
  }
  return name;
}

function validateTone(tone: string): ChipTone {
  if (!(TAG_TONES as readonly string[]).includes(tone)) {
    throw new Error(`Invalid tone: ${tone}`);
  }
  return tone as ChipTone;
}

// ─── Project-scoped tag CRUD ─────────────────────────────────────────────────

export async function listTagsForProject(
  projectId: string,
): Promise<TaskTag[]> {
  const { data, error } = await db()
    .from("TaskTag")
    .select("*")
    .eq("projectId", projectId)
    .order("name");
  if (error) throw error;
  return (data ?? []).map(toTag);
}

export async function createTag(input: {
  projectId: string;
  name: string;
  tone: ChipTone;
}): Promise<TaskTag> {
  const name = validateName(input.name);
  const tone = validateTone(input.tone);
  const { data, error } = await db()
    .from("TaskTag")
    .insert({ projectId: input.projectId, name, tone })
    .select("*")
    .single();
  if (error) throw error;
  return toTag(data);
}

export async function renameTag(
  tagId: string,
  name: string,
): Promise<TaskTag> {
  const trimmed = validateName(name);
  const { data, error } = await db()
    .from("TaskTag")
    .update({ name: trimmed, updatedAt: new Date().toISOString() })
    .eq("id", tagId)
    .select("*")
    .single();
  if (error) throw error;
  return toTag(data);
}

export async function recolorTag(
  tagId: string,
  tone: ChipTone,
): Promise<TaskTag> {
  const validated = validateTone(tone);
  const { data, error } = await db()
    .from("TaskTag")
    .update({ tone: validated, updatedAt: new Date().toISOString() })
    .eq("id", tagId)
    .select("*")
    .single();
  if (error) throw error;
  return toTag(data);
}

export async function deleteTag(tagId: string): Promise<void> {
  const { error } = await db().from("TaskTag").delete().eq("id", tagId);
  if (error) throw error;
}

// ─── Task ↔ Tag assignment ──────────────────────────────────────────────────

export async function listTagsForTask(taskId: string): Promise<TaskTag[]> {
  const { data, error } = await db()
    .from("TaskTagAssignment")
    .select("TaskTag(*)")
    .eq("taskId", taskId);
  if (error) throw error;
  const rows = (data ?? [])
    .map((r) => r.TaskTag as TaskTagRow | null)
    .filter((r): r is TaskTagRow => Boolean(r));
  return rows.map(toTag).sort((a, b) => a.name.localeCompare(b.name));
}

export async function listTagsForTasks(
  taskIds: string[],
): Promise<Record<string, TaskTag[]>> {
  if (taskIds.length === 0) return {};
  const { data, error } = await db()
    .from("TaskTagAssignment")
    .select("taskId, TaskTag(*)")
    .in("taskId", taskIds);
  if (error) throw error;
  const out: Record<string, TaskTag[]> = {};
  for (const row of data ?? []) {
    const tag = row.TaskTag as TaskTagRow | null;
    if (!tag) continue;
    (out[row.taskId] ??= []).push(toTag(tag));
  }
  for (const id of Object.keys(out)) {
    out[id].sort((a, b) => a.name.localeCompare(b.name));
  }
  return out;
}

// Replace strategy: diff current vs desired and apply minimal changes.
// Enforces hard limit (10) before write — short-circuits before touching DB.
export async function setTagsForTask(
  taskId: string,
  tagIds: string[],
): Promise<void> {
  const desired = Array.from(new Set(tagIds));
  if (desired.length > TASK_TAG_LIMIT) {
    throw new Error(`Task can have at most ${TASK_TAG_LIMIT} tags`);
  }

  const { data: currentRows, error: readErr } = await db()
    .from("TaskTagAssignment")
    .select("tagId")
    .eq("taskId", taskId);
  if (readErr) throw readErr;
  const current = new Set((currentRows ?? []).map((r) => r.tagId));
  const next = new Set(desired);

  const toAdd = desired.filter((id) => !current.has(id));
  const toRemove = [...current].filter((id) => !next.has(id));

  if (toRemove.length > 0) {
    const { error } = await db()
      .from("TaskTagAssignment")
      .delete()
      .eq("taskId", taskId)
      .in("tagId", toRemove);
    if (error) throw error;
  }

  if (toAdd.length > 0) {
    const { error } = await db()
      .from("TaskTagAssignment")
      .insert(toAdd.map((tagId) => ({ taskId, tagId })));
    if (error) throw error;
  }
}

export async function addTagToTask(
  taskId: string,
  tagId: string,
): Promise<void> {
  const { error } = await db()
    .from("TaskTagAssignment")
    .insert({ taskId, tagId });
  if (error && error.code !== "23505") throw error;
}

export async function removeTagFromTask(
  taskId: string,
  tagId: string,
): Promise<void> {
  const { error } = await db()
    .from("TaskTagAssignment")
    .delete()
    .eq("taskId", taskId)
    .eq("tagId", tagId);
  if (error) throw error;
}
