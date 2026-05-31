import "server-only";
import { db } from "@/lib/db";
import type { Database } from "@/lib/supabase/database.types";

type Tables = Database["public"]["Tables"];

export type ForgeLearningRow = Tables["ForgeLearning"]["Row"];
export type ForgeLearningInsert = Tables["ForgeLearning"]["Insert"];
export type ForgeLearningUpdate = Tables["ForgeLearning"]["Update"];

export type ProfileScope = "db" | "api" | "ui" | "wiring" | "test" | "doc" | "all";

// ─── CRUD: ForgeLearning ──────────────────────────────────────────────────────

/**
 * Record a learning (anti-pattern, best practice, pitfall) discovered during a run.
 * Used by workers via the record_learning tool.
 */
export async function recordLearning(input: {
  ownerId: string;
  projectId?: string | null;
  slug: string;
  lesson: string;
  profileScope?: ProfileScope | null;
  severity?: "info" | "warn" | "block";
}): Promise<ForgeLearningRow> {
  const { data, error } = await db()
    .from("ForgeLearning")
    .insert({
      ownerId: input.ownerId,
      projectId: input.projectId ?? null,
      slug: input.slug,
      lesson: input.lesson,
      profileScope: input.profileScope ?? null,
      severity: input.severity ?? "info",
    })
    .select("*")
    .single();
  if (error) throw error;
  return data;
}

/**
 * List learnings for a given profile scope.
 * Used by Planner to inject learnings into worker prompts.
 */
export async function listLearnings(
  ownerId: string,
  profileScope: ProfileScope | null,
): Promise<ForgeLearningRow[]> {
  let query = db()
    .from("ForgeLearning")
    .select("*")
    .eq("ownerId", ownerId)
    .order("addedAt", { ascending: false });

  // Filter by profileScope: match exact scope OR 'all'
  if (profileScope) {
    query = query.or(`profileScope.eq.${profileScope},profileScope.eq.all`);
  } else {
    query = query.is("profileScope", null);
  }

  const { data, error } = await query;
  if (error) throw error;
  return data ?? [];
}

/**
 * Delete a learning by ID.
 */
export async function deleteLearning(id: string): Promise<void> {
  const { error } = await db().from("ForgeLearning").delete().eq("id", id);
  if (error) throw error;
}
