import "server-only";
import { db } from "@/lib/db";

// Manual types until database.types.ts is regenerated (OPP-005 blocker)
export type OpportunityRow = {
  id: string;
  clientId: string;
  title: string;
  description: string | null;
  impact: number;
  effort: number;
  status: "discovery" | "evaluating" | "approved" | "in_project" | "rejected";
  priorityRank: number | null;
  sourceMeetingId: string | null;
  sourceDesignSessionId: string | null;
  sourceTranscriptRefId: string | null;
  promotedProjectId: string | null;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
};

export type OpportunityStatus =
  | "discovery"
  | "evaluating"
  | "approved"
  | "in_project"
  | "rejected";

export type CreateOpportunityInput = {
  clientId: string;
  title: string;
  description?: string | null;
  impact: number;
  effort: number;
  status?: OpportunityStatus;
  priorityRank?: number | null;
  sourceMeetingId?: string | null;
  sourceDesignSessionId?: string | null;
  sourceTranscriptRefId?: string | null;
  createdBy: string;
};

export type UpdateOpportunityInput = Partial<{
  title: string;
  description: string | null;
  impact: number;
  effort: number;
  status: OpportunityStatus;
  priorityRank: number | null;
}>;

/**
 * List all opportunities for a given client, ordered by priority.
 * Default sort: priorityRank (manual override) if set, otherwise by score descending.
 * Score = impact * 5 - effort (per PRD §D9).
 */
export async function listByClient(
  clientId: string,
): Promise<OpportunityRow[]> {
  const { data, error } = await db()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Table not in database.types.ts yet (OPP-005)
    .from("Opportunity" as any)
    .select("*")
    .eq("clientId", clientId)
    .order("priorityRank", { ascending: true, nullsFirst: false })
    .order("createdAt", { ascending: false });

  if (error) throw error;
  // @ts-expect-error -- Table not in database.types.ts yet (OPP-005)
  return (data ?? []) as OpportunityRow[];
}

/**
 * Get a single opportunity by ID.
 */
export async function getById(id: string): Promise<OpportunityRow | null> {
  const { data, error } = await db()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Table not in database.types.ts yet (OPP-005)
    .from("Opportunity" as any)
    .select("*")
    .eq("id", id)
    .maybeSingle();

  if (error) throw error;
  return data as OpportunityRow | null;
}

/**
 * Create a new opportunity.
 */
export async function create(
  input: CreateOpportunityInput,
): Promise<OpportunityRow> {
  const { data, error } = await db()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Table not in database.types.ts yet (OPP-005)
    .from("Opportunity" as any)
    .insert({
      clientId: input.clientId,
      title: input.title,
      description: input.description ?? null,
      impact: input.impact,
      effort: input.effort,
      status: input.status ?? "discovery",
      priorityRank: input.priorityRank ?? null,
      sourceMeetingId: input.sourceMeetingId ?? null,
      sourceDesignSessionId: input.sourceDesignSessionId ?? null,
      sourceTranscriptRefId: input.sourceTranscriptRefId ?? null,
      createdBy: input.createdBy,
    })
    .select("*")
    .single();

  if (error) throw error;
  // @ts-expect-error -- Table not in database.types.ts yet (OPP-005)
  return data as OpportunityRow;
}

/**
 * Update an existing opportunity.
 */
export async function update(
  id: string,
  patch: UpdateOpportunityInput,
): Promise<OpportunityRow> {
  const { data, error } = await db()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Table not in database.types.ts yet (OPP-005)
    .from("Opportunity" as any)
    .update({ ...patch, updatedAt: new Date().toISOString() })
    .eq("id", id)
    .select("*")
    .single();

  if (error) throw error;
  // @ts-expect-error -- Table not in database.types.ts yet (OPP-005)
  return data as OpportunityRow;
}

/**
 * Soft-reject an opportunity (set status to 'rejected').
 * Per PRD §D11: soft-delete via status='rejected', no deletedAt column.
 */
export async function softReject(id: string): Promise<OpportunityRow> {
  return update(id, { status: "rejected" });
}

/**
 * Promote an opportunity to a Project + DesignSession (inception).
 *
 * Per PRD §D10: idempotent — if promotedProjectId already exists, early return.
 * Otherwise runs transaction:
 *   1. INSERT Project (clientId from Opportunity, name=title, description from Opportunity)
 *   2. INSERT DesignSession (kind=inception, projectId, description from Opportunity)
 *   3. UPDATE Opportunity (status=in_project, promotedProjectId)
 *
 * Returns { projectId, designSessionId }.
 */
export async function promote(
  id: string,
  projectName?: string,
): Promise<{ projectId: string; designSessionId: string }> {
  const supabase = db();

  // 1. Idempotency check: if already promoted, return existing IDs
  const { data: opportunity, error: oppErr } = await supabase
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Table not in database.types.ts yet (OPP-005)
    .from("Opportunity" as any)
    .select("*")
    .eq("id", id)
    .single();

  if (oppErr) throw oppErr;
  if (!opportunity) throw new Error("Opportunity not found");
  // @ts-expect-error -- Table not in database.types.ts yet (OPP-005)
  const opp = opportunity as OpportunityRow;

  if (opp.promotedProjectId) {
    // Already promoted — fetch the design session
    const { data: ds, error: dsErr } = await supabase
      .from("DesignSession")
      .select("id")
      .eq("projectId", opp.promotedProjectId)
      .eq("type", "inception")
      .maybeSingle();

    if (dsErr) throw dsErr;
    if (!ds) {
      throw new Error(
        "Promoted project exists but no inception session found — data inconsistency",
      );
    }

    return {
      projectId: opp.promotedProjectId,
      designSessionId: ds.id,
    };
  }

  // 2. Create Project
  const projectId = crypto.randomUUID();
  const { error: projectErr } = await supabase.from("Project").insert({
    id: projectId,
    clientId: opp.clientId,
    name: projectName ?? opp.title,
    pmId: opp.createdBy,
    updatedAt: new Date().toISOString(),
  });

  if (projectErr) throw projectErr;

  // 3. Create DesignSession (inception)
  const designSessionId = crypto.randomUUID();
  const { error: dsErr } = await supabase.from("DesignSession").insert({
    id: designSessionId,
    projectId,
    type: "inception",
    title: `Inception — ${projectName ?? opp.title}`,
    description: opp.description,
    status: "in_progress",
    createdBy: opp.createdBy,
    facilitatorId: opp.createdBy,
    totalSteps: 10,
    updatedAt: new Date().toISOString(),
  });

  if (dsErr) throw dsErr;

  // 4. Update Opportunity
  const { error: updateErr } = await supabase
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Table not in database.types.ts yet (OPP-005)
    .from("Opportunity" as any)
    .update({
      status: "in_project",
      promotedProjectId: projectId,
      updatedAt: new Date().toISOString(),
    })
    .eq("id", id);

  if (updateErr) throw updateErr;

  return { projectId, designSessionId };
}
