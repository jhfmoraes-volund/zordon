import "server-only";
import { db } from "@/lib/db";
import type { Database } from "@/lib/supabase/database.types";

type Tables = Database["public"]["Tables"];
export type TaskRow = Tables["Task"]["Row"];
export type AcRow = Tables["AcceptanceCriterion"]["Row"];

export type TaskSnapshot = {
  task: TaskRow;
  assigneeIds: string[];
  tagIds: string[];
};

export type AcSnapshot = {
  byId: Record<string, AcRow>;
};

function uniqSorted(values: (string | null | undefined)[]): string[] {
  const set = new Set<string>();
  for (const v of values) {
    if (typeof v === "string" && v.length > 0) set.add(v);
  }
  return [...set].sort();
}

export async function snapshotTaskHydrated(
  taskId: string,
): Promise<TaskSnapshot | null> {
  const supabase = db();
  const [taskRes, assignRes, tagRes] = await Promise.all([
    supabase.from("Task").select("*").eq("id", taskId).maybeSingle(),
    supabase.from("TaskAssignment").select("memberId").eq("taskId", taskId),
    supabase.from("TaskTagAssignment").select("tagId").eq("taskId", taskId),
  ]);
  if (taskRes.error || !taskRes.data) return null;
  const assigneeIds = uniqSorted((assignRes.data ?? []).map((r) => r.memberId));
  const tagIds = uniqSorted((tagRes.data ?? []).map((r) => r.tagId));
  return { task: taskRes.data, assigneeIds, tagIds };
}

export async function snapshotAcceptance(taskId: string): Promise<AcSnapshot> {
  const { data } = await db()
    .from("AcceptanceCriterion")
    .select("*")
    .eq("taskId", taskId);
  const byId: Record<string, AcRow> = {};
  for (const ac of data ?? []) byId[ac.id] = ac;
  return { byId };
}
