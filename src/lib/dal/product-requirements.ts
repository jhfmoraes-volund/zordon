import "server-only";
import { db } from "@/lib/db";
import type { Database, Json } from "@/lib/supabase/database.types";

type Tables = Database["public"]["Tables"];

export type ProductRequirementRow = Tables["ProductRequirement"]["Row"];
export type ProductRequirementInsert = Tables["ProductRequirement"]["Insert"];
export type ProductRequirementUpdate = Tables["ProductRequirement"]["Update"];

export type PrdStatus = "draft" | "review" | "approved" | "superseded";
export type PrdActorAgent = "vitor" | "vitoria" | "system";
export type PrdActivityKind =
  | "created"
  | "updated"
  | "approved"
  | "superseded"
  | "materialized";

// ─── Activity log ─────────────────────────────────────────────────────────────

export async function recordPrdActivity(args: {
  productRequirementId: string;
  kind: PrdActivityKind;
  diff?: object;
  actorMemberId?: string | null;
  actorAgent?: PrdActorAgent;
}): Promise<void> {
  const { error } = await db()
    .from("ProductRequirementActivity")
    .insert({
      productRequirementId: args.productRequirementId,
      kind: args.kind,
      diff: (args.diff ?? {}) as Json,
      actorMemberId: args.actorMemberId ?? null,
      actorAgent: args.actorAgent ?? null,
    });
  if (error) throw error;
}

// ─── Reads ────────────────────────────────────────────────────────────────────

export async function getPrdsForProject(
  projectId: string,
  opts?: { status?: PrdStatus[]; moduleId?: string | null },
): Promise<ProductRequirementRow[]> {
  let query = db()
    .from("ProductRequirement")
    .select("*")
    .eq("projectId", projectId)
    .is("dismissedAt", null);

  if (opts?.status && opts.status.length > 0) {
    query = query.in("status", opts.status);
  }
  if (opts?.moduleId !== undefined) {
    if (opts.moduleId === null) {
      query = query.is("moduleId", null);
    } else {
      query = query.eq("moduleId", opts.moduleId);
    }
  }

  const { data, error } = await query.order("createdAt", { ascending: false });
  if (error) throw error;
  return data ?? [];
}

export async function getPrdsForSession(
  designSessionId: string,
): Promise<ProductRequirementRow[]> {
  const { data, error } = await db()
    .from("ProductRequirement")
    .select("*")
    .eq("designSessionId", designSessionId)
    .is("dismissedAt", null)
    .order("createdAt", { ascending: true });
  if (error) throw error;
  return data ?? [];
}

export async function getPrdById(
  id: string,
): Promise<ProductRequirementRow | null> {
  const { data, error } = await db()
    .from("ProductRequirement")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;
  return data ?? null;
}

/**
 * Batch-fetch PRDs por id. Usado pra hidratar PlanningSessionPRD entity-backed.
 */
export async function getPrdsByIds(
  ids: string[],
): Promise<ProductRequirementRow[]> {
  if (ids.length === 0) return [];
  const { data, error } = await db()
    .from("ProductRequirement")
    .select("*")
    .in("id", ids);
  if (error) throw error;
  return data ?? [];
}

/**
 * Reference no formato `<projectKey>-PRD-NNN` com NNN zero-padded a 3.
 * Conta PRDs do projeto (inclusive dismissed) + 1 — assume não-recicláveis.
 */
export async function nextPrdReference(projectId: string): Promise<string> {
  const supabase = db();

  const { data: project, error: pErr } = await supabase
    .from("Project")
    .select("referenceKey")
    .eq("id", projectId)
    .single();
  if (pErr) throw pErr;
  if (!project?.referenceKey) {
    throw new Error(
      `Project ${projectId} sem referenceKey — defina via setProjectReferenceKey`,
    );
  }

  const { count, error: cErr } = await supabase
    .from("ProductRequirement")
    .select("id", { count: "exact", head: true })
    .eq("projectId", projectId);
  if (cErr) throw cErr;

  const next = (count ?? 0) + 1;
  return `${project.referenceKey}-PRD-${String(next).padStart(3, "0")}`;
}

// ─── Mutations ────────────────────────────────────────────────────────────────

export async function createPrd(
  input: Omit<
    ProductRequirementInsert,
    "id" | "reference" | "createdAt" | "updatedAt" | "markdown"
  > & {
    actorAgent?: PrdActorAgent;
    actorMemberId?: string | null;
  },
): Promise<ProductRequirementRow> {
  const { actorAgent, actorMemberId, ...insertInput } = input;
  const reference = await nextPrdReference(insertInput.projectId);

  const { data, error } = await db()
    .from("ProductRequirement")
    .insert({
      ...insertInput,
      reference,
    })
    .select("*")
    .single();
  if (error) throw error;

  await recordPrdActivity({
    productRequirementId: data.id,
    kind: "created",
    diff: { after: data as unknown as Record<string, unknown> },
    actorAgent,
    actorMemberId,
  });

  return data;
}

export async function updatePrd(
  id: string,
  patch: ProductRequirementUpdate,
  ctx: { actorAgent?: PrdActorAgent; actorMemberId?: string | null },
): Promise<ProductRequirementRow> {
  const before = await getPrdById(id);
  if (!before) throw new Error(`PRD ${id} not found`);

  const { data, error } = await db()
    .from("ProductRequirement")
    .update({ ...patch, updatedAt: new Date().toISOString() })
    .eq("id", id)
    .select("*")
    .single();
  if (error) throw error;

  const diff: Record<string, { before: unknown; after: unknown }> = {};
  for (const key of Object.keys(patch) as Array<keyof ProductRequirementUpdate>) {
    const beforeVal = (before as unknown as Record<string, unknown>)[key as string];
    const afterVal = (data as unknown as Record<string, unknown>)[key as string];
    if (JSON.stringify(beforeVal) !== JSON.stringify(afterVal)) {
      diff[key as string] = { before: beforeVal, after: afterVal };
    }
  }

  await recordPrdActivity({
    productRequirementId: id,
    kind: "updated",
    diff,
    actorAgent: ctx.actorAgent,
    actorMemberId: ctx.actorMemberId,
  });

  return data;
}

/**
 * Aprova PRD. Valida quality gates em JS antes do UPDATE pra retornar erro
 * legível (caller pode mapear pra 422).
 *
 * Gates:
 *   - problem.length >= 50
 *   - goal.length >= 20
 *   - acceptanceCriteria.length >= 3
 */
export async function approvePrd(
  id: string,
  ctx: { actorMemberId: string },
): Promise<ProductRequirementRow> {
  const current = await getPrdById(id);
  if (!current) throw new Error(`PRD ${id} not found`);

  if ((current.problem ?? "").trim().length < 50) {
    throw new Error(
      "PRD.problem precisa ter ao menos 50 caracteres pra ser aprovado",
    );
  }
  if ((current.goal ?? "").trim().length < 20) {
    throw new Error(
      "PRD.goal precisa ter ao menos 20 caracteres pra ser aprovado",
    );
  }
  const acArr = Array.isArray(current.acceptanceCriteria)
    ? (current.acceptanceCriteria as unknown[])
    : [];
  if (acArr.length < 3) {
    throw new Error(
      "PRD precisa de ao menos 3 acceptance criteria pra ser aprovado",
    );
  }

  const nowIso = new Date().toISOString();
  const { data, error } = await db()
    .from("ProductRequirement")
    .update({
      status: "approved",
      approvedAt: nowIso,
      approvedBy: ctx.actorMemberId,
      updatedAt: nowIso,
    })
    .eq("id", id)
    .select("*")
    .single();
  if (error) throw error;

  await recordPrdActivity({
    productRequirementId: id,
    kind: "approved",
    diff: {
      before: { status: current.status, approvedAt: current.approvedAt },
      after: { status: data.status, approvedAt: data.approvedAt },
    },
    actorMemberId: ctx.actorMemberId,
    actorAgent: undefined,
  });

  return data;
}

/**
 * PRDs aprovados que ainda não foram materializados em Tasks
 * (sem Task com productRequirementId apontando pra eles).
 */
export async function listPrdsApprovedNotMaterialized(
  projectId: string,
): Promise<ProductRequirementRow[]> {
  const supabase = db();

  const { data: prds, error: prdErr } = await supabase
    .from("ProductRequirement")
    .select("*")
    .eq("projectId", projectId)
    .eq("status", "approved")
    .is("dismissedAt", null)
    .order("createdAt", { ascending: false });
  if (prdErr) throw prdErr;
  if (!prds || prds.length === 0) return [];

  const prdIds = prds.map((p) => p.id);
  const { data: materialized, error: tErr } = await supabase
    .from("Task")
    .select("productRequirementId")
    .in("productRequirementId", prdIds)
    .is("dismissedAt", null);
  if (tErr) throw tErr;

  const materializedSet = new Set(
    (materialized ?? [])
      .map((t) => t.productRequirementId)
      .filter((x): x is string => x !== null),
  );

  return prds.filter((p) => !materializedSet.has(p.id));
}
