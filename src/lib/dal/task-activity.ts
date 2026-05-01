import "server-only";
import { db } from "@/lib/db";
import type { Database } from "@/lib/supabase/database.types";

type Tables = Database["public"]["Tables"];
export type TaskActivityRow = Tables["TaskActivity"]["Row"];

export type TaskActivityType =
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
): Promise<TaskActivityWithActor[]> {
  const { data, error } = await db()
    .from("TaskActivity")
    .select("*, actor:Member!TaskActivity_actorMemberId_fkey(id, name)")
    .eq("taskId", taskId)
    .order("createdAt", { ascending: false });
  if (error) throw error;
  return (data ?? []) as unknown as TaskActivityWithActor[];
}
