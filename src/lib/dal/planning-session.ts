import "server-only";
import { db } from "@/lib/db";
import type { Database } from "@/lib/supabase/database.types";
import { getPrdsByIds } from "@/lib/dal/product-requirements";

type Tables = Database["public"]["Tables"];

export type PlanningSessionRow = Tables["PlanningSession"]["Row"];
export type PlanningSessionInsert = Tables["PlanningSession"]["Insert"];
export type PlanningSessionUpdate = Tables["PlanningSession"]["Update"];

export type PlanningSessionPRDRow = Tables["PlanningSessionPRD"]["Row"];
export type PlanningSessionPRDInsert = Tables["PlanningSessionPRD"]["Insert"];
export type PlanningSessionPRDUpdate = Tables["PlanningSessionPRD"]["Update"];

/** PlanningSessionPRD com o ProductRequirement hidratado (quando entity-backed). */
export type PlanningSessionPRDWithSource = PlanningSessionPRDRow & {
  productRequirement: {
    id: string;
    reference: string;
    title: string;
    status: string;
  } | null;
};

export type PlanningSessionStatus =
  | "draft"
  | "orchestrating"
  | "in-review"
  | "approved"
  | "aborted"
  | "error";

/**
 * Status "ativos" (não-terminais) de uma planning. Espelha o predicado do índice
 * único parcial `planning_session_one_active_per_project` — a fonte da verdade do
 * singleton "1 planning viva por projeto". Mantê-los em sincronia.
 */
export const ACTIVE_PLANNING_STATUSES: PlanningSessionStatus[] = [
  "draft",
  "orchestrating",
  "in-review",
];

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
 * Get a PlanningSession by ID with PRDs inlined.
 * PRDs entity-backed (productRequirementId != null) vêm com o ProductRequirement
 * hidratado; slug-backed mantêm productRequirement = null.
 */
export async function getSession(
  sessionId: string,
): Promise<
  | (PlanningSessionRow & {
      projectName: string | null;
      prds: PlanningSessionPRDWithSource[];
    })
  | null
> {
  const { data: session, error: sessionError } = await db()
    .from("PlanningSession")
    .select("*, project:Project!PlanningSession_projectId_fkey(name)")
    .eq("id", sessionId)
    .maybeSingle();
  if (sessionError) throw sessionError;
  if (!session) return null;
  const { project, ...sessionRow } = session as PlanningSessionRow & {
    project: { name: string | null } | null;
  };

  const { data: prds, error: prdsError } = await db()
    .from("PlanningSessionPRD")
    .select("*")
    .eq("planningSessionId", sessionId)
    .order("sprintStart", { ascending: true })
    .order("order", { ascending: true });
  if (prdsError) throw prdsError;

  const prdRows = prds ?? [];
  const requirementIds = prdRows
    .map((p) => p.productRequirementId)
    .filter((id): id is string => !!id);
  const requirements = await getPrdsByIds(requirementIds);
  const reqById = new Map(requirements.map((r) => [r.id, r]));

  const hydrated: PlanningSessionPRDWithSource[] = prdRows.map((p) => {
    const req = p.productRequirementId
      ? reqById.get(p.productRequirementId)
      : undefined;
    return {
      ...p,
      productRequirement: req
        ? {
            id: req.id,
            reference: req.reference,
            title: req.title,
            status: req.status,
          }
        : null,
    };
  });

  return {
    ...sessionRow,
    projectName: project?.name ?? null,
    prds: hydrated,
  };
}

/**
 * Retorna a PlanningSession ATIVA (não-terminal) de um projeto, se existir.
 * Base do resolve-or-create do singleton: a API usa isso pra devolver a planning
 * existente em vez de criar uma 2ª. O índice único parcial
 * `planning_session_one_active_per_project` é a garantia dura no banco.
 */
export async function findActiveSessionForProject(
  projectId: string,
): Promise<PlanningSessionRow | null> {
  const { data, error } = await db()
    .from("PlanningSession")
    .select("*")
    .eq("projectId", projectId)
    .in("status", ACTIVE_PLANNING_STATUSES)
    .order("createdAt", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data ?? null;
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

/**
 * Update editable PlanningSession fields (title, facilitator, scheduled date, sprint count).
 */
export async function updateSession(
  sessionId: string,
  patch: {
    title?: string;
    facilitatorId?: string | null;
    scheduledFor?: string | null;
    sprintCount?: number;
  },
): Promise<PlanningSessionRow> {
  const update: PlanningSessionUpdate = {
    ...patch,
    updatedAt: new Date().toISOString(),
  };
  const { data, error } = await db()
    .from("PlanningSession")
    .update(update)
    .eq("id", sessionId)
    .select("*")
    .single();
  if (error) throw error;
  return data;
}

/**
 * Hard-delete a PlanningSession. PlanningSessionPRD e EntityLink caem por
 * ON DELETE CASCADE.
 */
export async function deleteSession(sessionId: string): Promise<void> {
  const { error } = await db()
    .from("PlanningSession")
    .delete()
    .eq("id", sessionId);
  if (error) throw error;
}

/**
 * Resolve-or-create the "companion" PlanningCeremony for a Release Planning
 * session. A companion ceremony (sprintId NULL — multi-sprint via per-action
 * targetSprintId) hosts the task/story staging (MeetingTaskAction +
 * PlanningContextNote) so the /planning surface reuses the whole Sprint Planning
 * machinery (propose_task_action, notes, apply, approve/complete endpoints)
 * without teaching PlanningSession to manage tasks. Idempotent: the id lives on
 * PlanningSession.planningCeremonyId and is reused while non-archived.
 */
export async function ensureReleasePlanningCeremony(
  sessionId: string,
  projectId: string,
  facilitatorId: string | null,
): Promise<string> {
  const supabase = db();
  const { data: session, error: sErr } = await supabase
    .from("PlanningSession")
    .select("planningCeremonyId")
    .eq("id", sessionId)
    .maybeSingle();
  if (sErr) throw sErr;

  const existingId = session?.planningCeremonyId ?? null;
  if (existingId) {
    const { data: cer } = await supabase
      .from("PlanningCeremony")
      .select("id, phase")
      .eq("id", existingId)
      .maybeSingle();
    // Reusa só enquanto a companion está VIVA. Após um /complete (phase=closed)
    // ou arquivamento, cada novo lote de staging ganha uma companion fresca —
    // o /complete é append-only e irreversível, não dá pra reabrir o mesmo.
    if (cer && cer.phase !== "archived" && cer.phase !== "closed") return cer.id;
  }

  const now = new Date().toISOString();
  const { data: created, error: cErr } = await supabase
    .from("PlanningCeremony")
    .insert({
      projectId,
      sprintId: null,
      facilitatorId,
      phase: "idle",
      updatedAt: now,
    })
    .select("id")
    .single();
  if (cErr) throw cErr;

  const { error: linkErr } = await supabase
    .from("PlanningSession")
    .update({ planningCeremonyId: created.id, updatedAt: now })
    .eq("id", sessionId);
  if (linkErr) throw linkErr;

  return created.id;
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
    agentJustification?: string | null;
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

/**
 * Vincula um ProductRequirement (output do Vitor) a uma sprint da session.
 * `order` é append-to-sprint (max+1) quando não informado.
 * Idempotente via unique parcial (planningSessionId, productRequirementId).
 */
export async function addLinkedPrd(
  planningSessionId: string,
  productRequirementId: string,
  opts: {
    sprintStart: number;
    sprintCount?: number;
    order?: number;
    justification?: string;
  },
): Promise<PlanningSessionPRDRow> {
  let order = opts.order;
  if (order === undefined) {
    const { data: existing, error: maxErr } = await db()
      .from("PlanningSessionPRD")
      .select("order")
      .eq("planningSessionId", planningSessionId)
      .eq("sprintStart", opts.sprintStart)
      .order("order", { ascending: false })
      .limit(1);
    if (maxErr) throw maxErr;
    order = existing && existing.length > 0 ? existing[0].order + 1 : 0;
  }

  const insert: PlanningSessionPRDInsert = {
    planningSessionId,
    productRequirementId,
    prdSlug: null,
    sprintStart: opts.sprintStart,
    sprintCount: opts.sprintCount ?? 1,
    order,
    agentJustification: opts.justification ?? null,
  };
  const { data, error } = await db()
    .from("PlanningSessionPRD")
    .insert(insert)
    .select("*")
    .single();
  if (error) throw error;
  return data;
}

/**
 * Remove uma row de PlanningSessionPRD (entity-backed ou slug-backed).
 */
export async function removeLinkedPrd(prdRowId: string): Promise<void> {
  const { error } = await db()
    .from("PlanningSessionPRD")
    .delete()
    .eq("id", prdRowId);
  if (error) throw error;
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
  linkedBy: string | null,
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
