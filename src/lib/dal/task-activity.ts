import "server-only";
import { db } from "@/lib/db";
import type { Database } from "@/lib/supabase/database.types";

type Tables = Database["public"]["Tables"];
export type TaskActivityRow = Tables["TaskActivity"]["Row"];

export type TaskActivityType =
  | "created"
  | "status_changed"
  | "assignees_changed"
  | "sprint_changed"
  | "story_changed"
  | "fp_changed"
  | "scope_changed"
  | "complexity_changed"
  | "type_changed"
  | "tags_changed"
  | "ac_bulk_changed"
  | "title_edited"
  | "description_edited"
  | "duplicated"
  | "cloned_to"
  | "cloned_from";

export type TaskActivityWithActor = TaskActivityRow & {
  actor: { id: string; name: string | null } | null;
};

export async function createActivity(input: {
  taskId: string;
  type: TaskActivityType | string;
  payload?: Record<string, unknown>;
  actorMemberId?: string | null;
}): Promise<TaskActivityRow> {
  const { data, error } = await db()
    .from("TaskActivity")
    .insert({
      taskId: input.taskId,
      type: input.type,
      payload: (input.payload ?? {}) as TaskActivityRow["payload"],
      actorMemberId: input.actorMemberId ?? null,
    })
    .select("*")
    .single();
  if (error) throw error;
  return data;
}

export async function getActivityForTask(
  taskId: string,
  opts: { limit?: number; before?: string } = {},
): Promise<TaskActivityWithActor[]> {
  const limit = opts.limit ?? 50;
  let q = db()
    .from("TaskActivity")
    .select("*, actor:Member!TaskActivity_actorMemberId_fkey(id, name)")
    .eq("taskId", taskId)
    .order("createdAt", { ascending: false })
    .limit(limit);
  if (opts.before) q = q.lt("createdAt", opts.before);
  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []) as unknown as TaskActivityWithActor[];
}
