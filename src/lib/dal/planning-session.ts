import "server-only";
import { db } from "@/lib/db";
import type { Database } from "@/lib/supabase/database.types";

type Tables = Database["public"]["Tables"];

export type PlanningSessionRow = Tables["PlanningSession"]["Row"];
export type PlanningSessionInsert = Tables["PlanningSession"]["Insert"];
export type PlanningSessionUpdate = Tables["PlanningSession"]["Update"];

export type PlanningSessionPRDRow = Tables["PlanningSessionPRD"]["Row"];
export type PlanningSessionPRDInsert = Tables["PlanningSessionPRD"]["Insert"];
export type PlanningSessionPRDUpdate = Tables["PlanningSessionPRD"]["Update"];

export type PlanningSessionStatus =
  | "draft"
  | "orchestrating"
  | "in-review"
  | "approved"
  | "aborted"
  | "error";

// ─── CRUD: PlanningSession ────────────────────────────────────────────────────

/**
 * Create a new PlanningSession
 */
export async function createSession(
  input: Omit<PlanningSessionInsert, "id" | "createdAt" | "updatedAt">,
): Promise<PlanningSessionRow> {
  const { data, error } = await db()
    .from("PlanningSession")
    .insert(input)
    .select("*")
    .single();
  if (error) throw error;
  return data;
}

/**
 * Get a PlanningSession by ID with PRDs inlined
 */
export async function getSession(
  sessionId: string,
): Promise<(PlanningSessionRow & { prds: PlanningSessionPRDRow[] }) | null> {
  const { data: session, error: sessionError } = await db()
    .from("PlanningSession")
    .select("*")
    .eq("id", sessionId)
    .maybeSingle();
  if (sessionError) throw sessionError;
  if (!session) return null;

  const { data: prds, error: prdsError } = await db()
    .from("PlanningSessionPRD")
    .select("*")
    .eq("planningSessionId", sessionId)
    .order("sprintStart", { ascending: true })
    .order("order", { ascending: true });
  if (prdsError) throw prdsError;

  return {
    ...session,
    prds: prds ?? [],
  };
}

/**
 * List all PlanningSessions for a project
 */
export async function listForProject(
  projectId: string,
): Promise<PlanningSessionRow[]> {
  const { data, error } = await db()
    .from("PlanningSession")
    .select("*")
    .eq("projectId", projectId)
    .order("createdAt", { ascending: false });
  if (error) throw error;
  return data ?? [];
}

/**
 * Update PlanningSession status
 */
export async function updateStatus(
  sessionId: string,
  status: PlanningSessionStatus,
  opts?: {
    errorMessage?: string | null;
    approvedBy?: string | null;
  },
): Promise<PlanningSessionRow> {
  const patch: PlanningSessionUpdate = {
    status,
    updatedAt: new Date().toISOString(),
  };

  if (status === "approved") {
    patch.approvedAt = new Date().toISOString();
    patch.approvedBy = opts?.approvedBy ?? null;
  }

  if (status === "error" && opts?.errorMessage) {
    patch.errorMessage = opts.errorMessage;
  }

  const { data, error } = await db()
    .from("PlanningSession")
    .update(patch)
    .eq("id", sessionId)
    .select("*")
    .single();
  if (error) throw error;
  return data;
}

// ─── CRUD: PlanningSessionPRD ──────────────────────────────────────────────────

/**
 * Update PRD assignment (drag/drop)
 */
export async function updatePrdAssignment(
  prdId: string,
  assignment: {
    sprintStart?: number;
    sprintCount?: number;
    order?: number;
    ownerOverride?: string | null;
  },
): Promise<PlanningSessionPRDRow> {
  const { data, error } = await db()
    .from("PlanningSessionPRD")
    .update(assignment)
    .eq("id", prdId)
    .select("*")
    .single();
  if (error) throw error;
  return data;
}

/**
 * List all PRDs for a session
 */
export async function listPrds(
  planningSessionId: string,
): Promise<PlanningSessionPRDRow[]> {
  const { data, error } = await db()
    .from("PlanningSessionPRD")
    .select("*")
    .eq("planningSessionId", planningSessionId)
    .order("sprintStart", { ascending: true })
    .order("order", { ascending: true });
  if (error) throw error;
  return data ?? [];
}

// ─── CRUD: PlanningSessionContextLink ─────────────────────────────────────────

// Links unificados em EntityLink (contexto distinguido por contextSourceId preenchido).
export type PlanningSessionContextLinkRow = Tables["EntityLink"]["Row"];
export type PlanningSessionContextLinkInsert = Tables["EntityLink"]["Insert"];

/**
 * Link a ContextSource to a PlanningSession
 */
export async function linkContextSource(
  planningSessionId: string,
  contextSourceId: string,
  linkedBy: string,
): Promise<PlanningSessionContextLinkRow> {
  const { data, error } = await db()
    .from("EntityLink")
    .insert({
      planningSessionId,
      contextSourceId,
      linkedById: linkedBy,
    })
    .select("*")
    .single();
  if (error) throw error;
  return data;
}

/**
 * Unlink a ContextSource from a PlanningSession
 */
export async function unlinkContextSource(linkId: string): Promise<void> {
  const { error } = await db()
    .from("EntityLink")
    .delete()
    .eq("id", linkId);
  if (error) throw error;
}

/**
 * List all linked ContextSources for a PlanningSession
 */
export async function listLinkedContextSources(
  planningSessionId: string,
): Promise<PlanningSessionContextLinkRow[]> {
  const { data, error } = await db()
    .from("EntityLink")
    .select("*")
    .eq("planningSessionId", planningSessionId)
    .not("contextSourceId", "is", null)
    .order("linkedAt", { ascending: false });
  if (error) throw error;
  return data ?? [];
}
