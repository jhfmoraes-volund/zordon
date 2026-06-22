import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { getCurrentMember } from "@/lib/dal";
import { createClient } from "@/lib/supabase/server";
import type {
  Allocation,
  AllocationInput,
  AllocationItem,
  Category,
  CategoryMonthRow,
  CategoryTotal,
  Entry,
  EntryInput,
  EntryListItem,
  LaborByMember,
  OrgMonthRow,
  OverviewResponse,
  ProjectDetail,
  ProjectFinanceRow,
  ProjectMonthPoint,
  ProjectMonthRow,
  ProjectsResponse,
} from "./types";

/**
 * Acesso ao schema `finance`. Usa o client com cookie de sessão (RLS
 * `is_admin()` é a barreira real — decisão D2/D11); as rotas /api/finance/*
 * também asseram admin (defense-in-depth). O schema `finance` não está nos
 * tipos gerados, então o client é re-castado pra `.schema("finance")` e os
 * resultados pros tipos hand-authored (src/lib/finance/types.ts).
 *
 * Requer que `finance` esteja exposto ao PostgREST (Dashboard → API →
 * Exposed schemas). Sem isso, as queries retornam erro de schema.
 */
async function finance() {
  const sb = await createClient();
  // Public continua tipado em `sb`; só o acesso a finance é solto.
  const fin = (sb as unknown as SupabaseClient).schema("finance");
  return { sb, fin };
}

function monthBounds(fromMonth: string, toMonth: string) {
  return { from: `${fromMonth}-01`, to: `${toMonth}-01` };
}

/** Org-level: série mensal + totais por categoria, no range [from,to] (YYYY-MM). */
export async function getOverview(
  fromMonth: string,
  toMonth: string,
): Promise<OverviewResponse> {
  const { fin } = await finance();
  const { from, to } = monthBounds(fromMonth, toMonth);

  const [orgRes, catRes, compRes, laborRes] = await Promise.all([
    fin
      .from("v_org_month")
      .select("*")
      .gte("month", from)
      .lte("month", to)
      .order("month", { ascending: true }),
    fin.from("v_category_month").select("*").gte("month", from).lte("month", to),
    fin.from("v_member_comp_month").select("comp_cents").gte("month", from).lte("month", to),
    fin.from("v_project_labor_month").select("labor_cents").gte("month", from).lte("month", to),
  ]);
  if (orgRes.error) throw new Error(orgRes.error.message);
  if (catRes.error) throw new Error(catRes.error.message);
  if (compRes.error) throw new Error(compRes.error.message);
  if (laborRes.error) throw new Error(laborRes.error.message);

  const months = (orgRes.data ?? []) as OrgMonthRow[];
  const catRows = (catRes.data ?? []) as CategoryMonthRow[];
  const compCents = ((compRes.data ?? []) as { comp_cents: number }[]).reduce(
    (s, r) => s + Number(r.comp_cents),
    0,
  );
  const allocatedCents = ((laborRes.data ?? []) as { labor_cents: number }[]).reduce(
    (s, r) => s + Number(r.labor_cents),
    0,
  );

  const byCat = new Map<string, CategoryTotal>();
  for (const r of catRows) {
    const cur = byCat.get(r.category_id);
    if (cur) cur.amountCents += Number(r.amount_cents);
    else
      byCat.set(r.category_id, {
        categoryId: r.category_id,
        slug: r.slug,
        kind: r.kind,
        name: r.name,
        amountCents: Number(r.amount_cents),
      });
  }

  return {
    months,
    categories: [...byCat.values()].sort((a, b) => b.amountCents - a.amountCents),
    totals: {
      revenueCents: months.reduce((s, m) => s + Number(m.revenue_cents), 0),
      expenseCents: months.reduce((s, m) => s + Number(m.expense_cents), 0),
      netCents: months.reduce((s, m) => s + Number(m.net_cents), 0),
    },
    teamCost: {
      compCents,
      allocatedCents,
      overheadCents: Math.max(0, compCents - allocatedCents),
    },
  };
}

/** Por projeto: agrega v_project_month no range e anexa o nome do projeto. */
export async function getProjects(
  fromMonth: string,
  toMonth: string,
): Promise<ProjectsResponse> {
  const { sb, fin } = await finance();
  const { from, to } = monthBounds(fromMonth, toMonth);

  const res = await fin
    .from("v_project_month")
    .select("*")
    .gte("month", from)
    .lte("month", to);
  if (res.error) throw new Error(res.error.message);
  const rows = (res.data ?? []) as ProjectMonthRow[];

  const agg = new Map<string, ProjectFinanceRow>();
  for (const r of rows) {
    if (!r.project_id) continue;
    const cur = agg.get(r.project_id);
    const add = {
      revenueCents: Number(r.revenue_cents),
      expenseCents: Number(r.expense_cents),
      laborCents: Number(r.labor_cents),
      marginDirectCents: Number(r.margin_direct_cents),
      marginTeamCents: Number(r.margin_team_cents),
    };
    if (cur) {
      cur.revenueCents += add.revenueCents;
      cur.expenseCents += add.expenseCents;
      cur.laborCents += add.laborCents;
      cur.marginDirectCents += add.marginDirectCents;
      cur.marginTeamCents += add.marginTeamCents;
    } else {
      agg.set(r.project_id, { projectId: r.project_id, name: r.project_id, ...add });
    }
  }

  const ids = [...agg.keys()];
  if (ids.length > 0) {
    const nameRes = await sb.from("Project").select("id, name").in("id", ids);
    for (const p of nameRes.data ?? []) {
      const row = agg.get(p.id);
      if (row) row.name = p.name;
    }
  }

  return {
    projects: [...agg.values()].sort((a, b) => b.marginTeamCents - a.marginTeamCents),
  };
}

// ─── Categorias ─────────────────────────────────────────────────────────────

export async function listCategories(): Promise<Category[]> {
  const { fin } = await finance();
  const res = await fin.from("category").select("*").order("sort", { ascending: true });
  if (res.error) throw new Error(res.error.message);
  return (res.data ?? []) as Category[];
}

// ─── Entries (transações) ───────────────────────────────────────────────────

/** Lista entries (opcionalmente por categoria/projeto), com rótulos pro drill. */
export async function listEntries(filter: {
  categoryId?: string;
  projectId?: string;
}): Promise<EntryListItem[]> {
  const { sb, fin } = await finance();
  let q = fin.from("entry").select("*").order("created_at", { ascending: false });
  if (filter.categoryId) q = q.eq("category_id", filter.categoryId);
  if (filter.projectId) q = q.eq("project_id", filter.projectId);
  const res = await q;
  if (res.error) throw new Error(res.error.message);
  const rows = (res.data ?? []) as Entry[];

  const cats = await listCategories();
  const catMap = new Map(cats.map((c) => [c.id, c]));

  const projIds = [...new Set(rows.map((r) => r.project_id).filter(Boolean))] as string[];
  const memIds = [...new Set(rows.map((r) => r.member_id).filter(Boolean))] as string[];
  const projMap = new Map<string, string>();
  const memMap = new Map<string, string>();
  if (projIds.length) {
    const { data } = await sb.from("Project").select("id, name").in("id", projIds);
    for (const p of data ?? []) projMap.set(p.id, p.name);
  }
  if (memIds.length) {
    const { data } = await sb.from("Member").select("id, name").in("id", memIds);
    for (const m of data ?? []) memMap.set(m.id, m.name);
  }

  return rows.map((r) => {
    const cat = catMap.get(r.category_id);
    return {
      ...r,
      categoryName: cat?.name ?? "—",
      categorySlug: cat?.slug ?? "",
      categoryKind: cat?.kind ?? "expense",
      projectName: r.project_id ? (projMap.get(r.project_id) ?? null) : null,
      memberName: r.member_id ? (memMap.get(r.member_id) ?? null) : null,
    };
  });
}

async function currentMemberId(): Promise<string | null> {
  const m = await getCurrentMember();
  return m?.id ?? null;
}

/** Normaliza o input em row de DB, aplicando as regras de recorrência. */
function toRow(input: EntryInput, createdBy: string | null) {
  const recurring = input.recurrence !== "once";
  return {
    category_id: input.categoryId,
    project_id: input.projectId ?? null,
    member_id: input.memberId ?? null,
    amount_cents: input.amountCents,
    recurrence: input.recurrence,
    occurred_on: recurring ? null : (input.occurredOn ?? null),
    effective_from: recurring ? (input.effectiveFrom ?? null) : null,
    effective_to: recurring ? (input.effectiveTo ?? null) : null,
    vendor: input.vendor ?? null,
    description: input.description ?? null,
    created_by: createdBy,
  };
}

/** Valida regras que não cabem em CHECK (cross-table) + dá throw com mensagem clara. */
async function validateEntry(input: EntryInput) {
  if (!(input.amountCents > 0)) throw new Error("Valor deve ser maior que zero");
  const cats = await listCategories();
  const cat = cats.find((c) => c.id === input.categoryId);
  if (!cat) throw new Error("Categoria inválida");
  if (cat.requires_member && !input.memberId)
    throw new Error(`A categoria "${cat.name}" exige um membro`);
  if (input.recurrence === "once" && !input.occurredOn)
    throw new Error("Lançamento pontual exige a data");
  if (input.recurrence !== "once" && !input.effectiveFrom)
    throw new Error("Lançamento recorrente exige início da vigência");
}

export async function createEntry(input: EntryInput): Promise<Entry> {
  await validateEntry(input);
  const { fin } = await finance();
  const res = await fin
    .from("entry")
    .insert(toRow(input, await currentMemberId()))
    .select("*")
    .single();
  if (res.error) throw new Error(res.error.message);
  return res.data as Entry;
}

export async function updateEntry(id: string, input: EntryInput): Promise<Entry> {
  await validateEntry(input);
  const { fin } = await finance();
  const { created_by: _drop, ...patch } = toRow(input, null);
  void _drop; // não sobrescreve o autor original
  const res = await fin
    .from("entry")
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq("id", id)
    .select("*")
    .single();
  if (res.error) throw new Error(res.error.message);
  return res.data as Entry;
}

export async function deleteEntry(id: string): Promise<void> {
  const { fin } = await finance();
  const res = await fin.from("entry").delete().eq("id", id);
  if (res.error) throw new Error(res.error.message);
}

// ─── Alocação financeira (D12) ──────────────────────────────────────────────

const FAR_FUTURE = "9999-12-31";

function periodsOverlap(
  aFrom: string,
  aTo: string | null,
  bFrom: string,
  bTo: string | null,
): boolean {
  return aFrom <= (bTo ?? FAR_FUTURE) && bFrom <= (aTo ?? FAR_FUTURE);
}

async function attachAllocationNames(
  sb: Awaited<ReturnType<typeof finance>>["sb"],
  rows: Allocation[],
): Promise<AllocationItem[]> {
  const memIds = [...new Set(rows.map((r) => r.member_id))];
  const projIds = [...new Set(rows.map((r) => r.project_id))];
  const memMap = new Map<string, string>();
  const projMap = new Map<string, string>();
  if (memIds.length) {
    const { data } = await sb.from("Member").select("id, name").in("id", memIds);
    for (const m of data ?? []) memMap.set(m.id, m.name);
  }
  if (projIds.length) {
    const { data } = await sb.from("Project").select("id, name").in("id", projIds);
    for (const p of data ?? []) projMap.set(p.id, p.name);
  }
  return rows.map((r) => ({
    ...r,
    memberName: memMap.get(r.member_id) ?? "—",
    projectName: projMap.get(r.project_id) ?? "—",
  }));
}

export async function listAllocations(filter: {
  projectId?: string;
  memberId?: string;
}): Promise<AllocationItem[]> {
  const { sb, fin } = await finance();
  let q = fin
    .from("labor_allocation")
    .select("*")
    .order("effective_from", { ascending: false });
  if (filter.projectId) q = q.eq("project_id", filter.projectId);
  if (filter.memberId) q = q.eq("member_id", filter.memberId);
  const res = await q;
  if (res.error) throw new Error(res.error.message);
  return attachAllocationNames(sb, (res.data ?? []) as Allocation[]);
}

/** Σ% do membro em períodos que sobrepõem o novo ≤ 100 (resto = overhead). */
async function validateAllocation(input: AllocationInput, excludeId?: string) {
  if (!(input.percent > 0 && input.percent <= 100))
    throw new Error("Percentual deve estar entre 0 e 100");
  const { fin } = await finance();
  const res = await fin
    .from("labor_allocation")
    .select("id, percent, effective_from, effective_to")
    .eq("member_id", input.memberId);
  if (res.error) throw new Error(res.error.message);
  const others = ((res.data ?? []) as Allocation[]).filter((a) => a.id !== excludeId);
  const overlapping = others.filter((a) =>
    periodsOverlap(
      input.effectiveFrom,
      input.effectiveTo ?? null,
      a.effective_from,
      a.effective_to,
    ),
  );
  const sum = overlapping.reduce((s, a) => s + Number(a.percent), 0) + input.percent;
  if (sum > 100)
    throw new Error(
      `Alocação excede 100% no período (membro já tem ${sum - input.percent}% sobreposto)`,
    );
}

function allocRow(input: AllocationInput, createdBy: string | null) {
  return {
    member_id: input.memberId,
    project_id: input.projectId,
    percent: input.percent,
    effective_from: input.effectiveFrom,
    effective_to: input.effectiveTo ?? null,
    note: input.note ?? null,
    created_by: createdBy,
  };
}

export async function createAllocation(input: AllocationInput): Promise<Allocation> {
  await validateAllocation(input);
  const { fin } = await finance();
  const res = await fin
    .from("labor_allocation")
    .insert(allocRow(input, await currentMemberId()))
    .select("*")
    .single();
  if (res.error) throw new Error(res.error.message);
  return res.data as Allocation;
}

export async function updateAllocation(
  id: string,
  input: AllocationInput,
): Promise<Allocation> {
  await validateAllocation(input, id);
  const { fin } = await finance();
  const { created_by: _drop, ...patch } = allocRow(input, null);
  void _drop;
  const res = await fin
    .from("labor_allocation")
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq("id", id)
    .select("*")
    .single();
  if (res.error) throw new Error(res.error.message);
  return res.data as Allocation;
}

export async function deleteAllocation(id: string): Promise<void> {
  const { fin } = await finance();
  const res = await fin.from("labor_allocation").delete().eq("id", id);
  if (res.error) throw new Error(res.error.message);
}

// ─── Detalhe por projeto (drill de análise) ─────────────────────────────────

async function squadMemberIds(
  sb: Awaited<ReturnType<typeof finance>>["sb"],
  projectId: string,
): Promise<string[]> {
  const sq = await sb.from("ProjectSquad").select("squadId").eq("projectId", projectId);
  const squadIds = (sq.data ?? []).map((r: { squadId: string }) => r.squadId);
  if (!squadIds.length) return [];
  const sm = await sb.from("SquadMember").select("memberId").in("squadId", squadIds);
  return [...new Set((sm.data ?? []).map((r: { memberId: string }) => r.memberId))];
}

export async function getProjectDetail(
  projectId: string,
  fromMonth: string,
  toMonth: string,
): Promise<ProjectDetail> {
  const { sb, fin } = await finance();
  const { from, to } = monthBounds(fromMonth, toMonth);

  const [monthsRes, laborRes, nameRes, allocations, squad] = await Promise.all([
    fin
      .from("v_project_month")
      .select("*")
      .eq("project_id", projectId)
      .gte("month", from)
      .lte("month", to)
      .order("month", { ascending: true }),
    fin
      .from("v_project_member_labor_month")
      .select("member_id, labor_cents")
      .eq("project_id", projectId)
      .gte("month", from)
      .lte("month", to),
    sb.from("Project").select("name").eq("id", projectId).maybeSingle(),
    listAllocations({ projectId }),
    squadMemberIds(sb, projectId),
  ]);
  if (monthsRes.error) throw new Error(monthsRes.error.message);
  if (laborRes.error) throw new Error(laborRes.error.message);

  const months = (monthsRes.data ?? []) as ProjectMonthPoint[];
  const totals = months.reduce(
    (acc, m) => ({
      revenueCents: acc.revenueCents + Number(m.revenue_cents),
      expenseCents: acc.expenseCents + Number(m.expense_cents),
      laborCents: acc.laborCents + Number(m.labor_cents),
      marginDirectCents: acc.marginDirectCents + Number(m.margin_direct_cents),
      marginTeamCents: acc.marginTeamCents + Number(m.margin_team_cents),
    }),
    { revenueCents: 0, expenseCents: 0, laborCents: 0, marginDirectCents: 0, marginTeamCents: 0 },
  );

  // Labor por membro = Σ no período; % vigente vem da alocação sem effective_to.
  const laborRows = (laborRes.data ?? []) as { member_id: string; labor_cents: number }[];
  const laborByMemberMap = new Map<string, number>();
  for (const r of laborRows)
    laborByMemberMap.set(r.member_id, (laborByMemberMap.get(r.member_id) ?? 0) + Number(r.labor_cents));

  const currentPctByMember = new Map<string, number>();
  for (const a of allocations)
    if (a.effective_to === null) currentPctByMember.set(a.member_id, Number(a.percent));
  const nameByMember = new Map(allocations.map((a) => [a.member_id, a.memberName]));

  const laborByMember: LaborByMember[] = [...laborByMemberMap.entries()]
    .map(([memberId, laborCents]) => ({
      memberId,
      memberName: nameByMember.get(memberId) ?? "—",
      percent: currentPctByMember.get(memberId) ?? null,
      laborCents,
    }))
    .sort((a, b) => b.laborCents - a.laborCents);

  return {
    projectId,
    name: (nameRes.data?.name as string) ?? projectId,
    months,
    totals,
    laborByMember,
    allocations,
    squadMemberIds: squad,
  };
}
