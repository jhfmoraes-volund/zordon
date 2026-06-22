import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { getCurrentMember } from "@/lib/dal";
import { createClient } from "@/lib/supabase/server";
import type {
  Allocation,
  AllocationInput,
  AllocationItem,
  Assumptions,
  AssumptionsInput,
  Category,
  CategoryMonthRow,
  CategoryTotal,
  Contract,
  ContractInput,
  Entry,
  Dre,
  EntryInput,
  EntryListItem,
  FpDelivery,
  FpDeliveryInput,
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
      agg.set(r.project_id, {
        projectId: r.project_id,
        name: r.project_id,
        sprintCount: 0,
        engagementType: null,
        ...add,
      });
    }
  }

  const ids = [...agg.keys()];
  if (ids.length > 0) {
    const [nameRes, sprintRes] = await Promise.all([
      sb.from("Project").select("id, name, engagementType").in("id", ids),
      sb.from("Sprint").select("projectId").in("projectId", ids),
    ]);
    for (const p of nameRes.data ?? []) {
      const row = agg.get(p.id);
      if (row) {
        row.name = p.name;
        row.engagementType = p.engagementType ?? null;
      }
    }
    for (const s of sprintRes.data ?? []) {
      const row = agg.get(s.projectId);
      if (row) row.sprintCount += 1;
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

// ─── Premissas + DRE (planilha Hitz) ────────────────────────────────────────

function mapAssumptions(r: Record<string, unknown>): Assumptions {
  return {
    id: String(r.id),
    projectId: (r.project_id as string | null) ?? null,
    issPct: Number(r.iss_pct),
    pisPct: Number(r.pis_pct),
    cofinsPct: Number(r.cofins_pct),
    sgaPct: Number(r.sga_pct),
    financialCostPct: Number(r.financial_cost_pct),
    irpjCsllPct: Number(r.irpj_csll_pct),
    targetMarginPct: Number(r.target_margin_pct),
    hoursPerFte: Number(r.hours_per_fte),
    aiPerFteCents: Number(r.ai_per_fte_cents),
    softwarePerHeadCents: Number(r.software_per_head_cents),
    equipCapexCents: Number(r.equip_capex_cents),
    equipLifeMonths: Number(r.equip_life_months),
  };
}

function toAssumptionsRow(input: AssumptionsInput) {
  return {
    iss_pct: input.issPct,
    pis_pct: input.pisPct,
    cofins_pct: input.cofinsPct,
    sga_pct: input.sgaPct,
    financial_cost_pct: input.financialCostPct,
    irpj_csll_pct: input.irpjCsllPct,
    target_margin_pct: input.targetMarginPct,
    hours_per_fte: input.hoursPerFte,
    ai_per_fte_cents: input.aiPerFteCents,
    software_per_head_cents: input.softwarePerHeadCents,
    equip_capex_cents: input.equipCapexCents,
    equip_life_months: input.equipLifeMonths,
  };
}

export async function getGlobalAssumptions(): Promise<Assumptions> {
  const { fin } = await finance();
  const res = await fin.from("assumptions").select("*").is("project_id", null).maybeSingle();
  if (res.error) throw new Error(res.error.message);
  if (!res.data) throw new Error("Premissas globais não encontradas (seed ausente)");
  return mapAssumptions(res.data);
}

export async function getEffectiveAssumptions(
  projectId?: string,
): Promise<{ assumptions: Assumptions; isOverride: boolean }> {
  const { fin } = await finance();
  if (projectId) {
    const res = await fin.from("assumptions").select("*").eq("project_id", projectId).maybeSingle();
    if (res.error) throw new Error(res.error.message);
    if (res.data) return { assumptions: mapAssumptions(res.data), isOverride: true };
  }
  return { assumptions: await getGlobalAssumptions(), isOverride: false };
}

export async function upsertAssumptions(
  projectId: string | null,
  input: AssumptionsInput,
): Promise<Assumptions> {
  const { fin } = await finance();
  const lookup = projectId
    ? await fin.from("assumptions").select("id").eq("project_id", projectId).maybeSingle()
    : await fin.from("assumptions").select("id").is("project_id", null).maybeSingle();
  const row = toAssumptionsRow(input);
  if (lookup.data) {
    const res = await fin
      .from("assumptions")
      .update({ ...row, updated_at: new Date().toISOString() })
      .eq("id", (lookup.data as { id: string }).id)
      .select("*")
      .single();
    if (res.error) throw new Error(res.error.message);
    return mapAssumptions(res.data);
  }
  const res = await fin
    .from("assumptions")
    .insert({ ...row, project_id: projectId, created_by: await currentMemberId() })
    .select("*")
    .single();
  if (res.error) throw new Error(res.error.message);
  return mapAssumptions(res.data);
}

export async function deleteAssumptionsOverride(projectId: string): Promise<void> {
  const { fin } = await finance();
  const res = await fin.from("assumptions").delete().eq("project_id", projectId);
  if (res.error) throw new Error(res.error.message);
}

/** Lista de meses (YYYY-MM-01) entre from e to (inclusive), ambos YYYY-MM. */
function monthList(fromMonth: string, toMonth: string): string[] {
  const [fy, fm] = fromMonth.split("-").map(Number);
  const [ty, tm] = toMonth.split("-").map(Number);
  const out: string[] = [];
  let y = fy;
  let m = fm;
  while (y < ty || (y === ty && m <= tm)) {
    out.push(`${y}-${String(m).padStart(2, "0")}-01`);
    m += 1;
    if (m > 12) {
      m = 1;
      y += 1;
    }
  }
  return out;
}

/** DRE no padrão da planilha P&L (faturamento → impostos → … → lucro líquido). */
export function computeDre(
  input: { revenueCents: number; directExpenseCents: number; laborCents: number; overheadCents: number; months: number },
  a: Assumptions,
): Dre {
  const faturamentoCents = input.revenueCents;
  const impostosCents = Math.round(faturamentoCents * (a.issPct + a.pisPct + a.cofinsPct));
  const receitaLiquidaCents = faturamentoCents - impostosCents;
  const custoDeliveryCents = input.laborCents + input.overheadCents + input.directExpenseCents;
  const monthsN = Math.max(input.months, 1);
  const custoFinanceiroCents = Math.round((custoDeliveryCents / monthsN) * a.financialCostPct);
  const margemBrutaCents = receitaLiquidaCents - custoDeliveryCents - custoFinanceiroCents;
  const sgaCents = Math.round(faturamentoCents * a.sgaPct);
  const lairCents = margemBrutaCents - sgaCents;
  const irpjCsllCents = lairCents > 0 ? Math.round(lairCents * a.irpjCsllPct) : 0;
  const lucroLiquidoCents = lairCents - irpjCsllCents;
  return {
    faturamentoCents,
    impostosCents,
    receitaLiquidaCents,
    laborCents: input.laborCents,
    overheadCents: input.overheadCents,
    directExpenseCents: input.directExpenseCents,
    custoDeliveryCents,
    custoFinanceiroCents,
    margemBrutaCents,
    sgaCents,
    lairCents,
    irpjCsllCents,
    lucroLiquidoCents,
    margemLiquidaPct: faturamentoCents > 0 ? lucroLiquidoCents / faturamentoCents : null,
  };
}

// ─── Contrato (billing por encomenda) + entregas de FP ──────────────────────

function mapContract(r: Record<string, unknown>): Contract {
  const num = (v: unknown) => (v === null || v === undefined ? null : Number(v));
  return {
    projectId: String(r.project_id),
    pricePerFpCents: num(r.price_per_fp_cents),
    contractedFp: num(r.contracted_fp),
    contractedSprints: num(r.contracted_sprints),
    note: (r.note as string | null) ?? null,
  };
}

export async function getContract(projectId: string): Promise<Contract | null> {
  const { fin } = await finance();
  const res = await fin.from("contract").select("*").eq("project_id", projectId).maybeSingle();
  if (res.error) throw new Error(res.error.message);
  return res.data ? mapContract(res.data) : null;
}

export async function upsertContract(
  projectId: string,
  input: ContractInput,
): Promise<Contract> {
  const { fin } = await finance();
  const row = {
    price_per_fp_cents: input.pricePerFpCents,
    contracted_fp: input.contractedFp,
    contracted_sprints: input.contractedSprints,
    note: input.note ?? null,
  };
  const lookup = await fin.from("contract").select("id").eq("project_id", projectId).maybeSingle();
  if (lookup.data) {
    const res = await fin
      .from("contract")
      .update({ ...row, updated_at: new Date().toISOString() })
      .eq("id", (lookup.data as { id: string }).id)
      .select("*")
      .single();
    if (res.error) throw new Error(res.error.message);
    return mapContract(res.data);
  }
  const res = await fin
    .from("contract")
    .insert({ ...row, project_id: projectId, created_by: await currentMemberId() })
    .select("*")
    .single();
  if (res.error) throw new Error(res.error.message);
  return mapContract(res.data);
}

export async function listFpDeliveries(projectId: string): Promise<FpDelivery[]> {
  const { fin } = await finance();
  const res = await fin
    .from("fp_delivery")
    .select("*")
    .eq("project_id", projectId)
    .order("month", { ascending: false });
  if (res.error) throw new Error(res.error.message);
  return ((res.data ?? []) as Record<string, unknown>[]).map((r) => ({
    id: String(r.id),
    project_id: String(r.project_id),
    month: String(r.month),
    fp_delivered: Number(r.fp_delivered),
    note: (r.note as string | null) ?? null,
    created_at: String(r.created_at),
  }));
}

export async function createFpDelivery(
  projectId: string,
  input: FpDeliveryInput,
): Promise<void> {
  if (!(input.fpDelivered > 0)) throw new Error("FP entregue deve ser maior que zero");
  if (!input.month) throw new Error("Mês da entrega é obrigatório");
  const { fin } = await finance();
  const res = await fin.from("fp_delivery").insert({
    project_id: projectId,
    month: input.month,
    fp_delivered: input.fpDelivered,
    note: input.note ?? null,
    created_by: await currentMemberId(),
  });
  if (res.error) throw new Error(res.error.message);
}

export async function deleteFpDelivery(id: string): Promise<void> {
  const { fin } = await finance();
  const res = await fin.from("fp_delivery").delete().eq("id", id);
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

  const [monthsRes, laborRes, nameRes, allocations, squad, eff, sprintRes, contract, fpRes] =
    await Promise.all([
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
    sb.from("Project").select("name, engagementType").eq("id", projectId).maybeSingle(),
    listAllocations({ projectId }),
    squadMemberIds(sb, projectId),
    getEffectiveAssumptions(projectId),
    sb.from("Sprint").select("id", { count: "exact", head: true }).eq("projectId", projectId),
    getContract(projectId),
    fin
      .from("v_fp_delivery_month")
      .select("fp_delivered, revenue_cents")
      .eq("project_id", projectId)
      .gte("month", from)
      .lte("month", to),
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

  // Overhead por pessoa (premissas × alocação): IA/FTE + software/cabeça +
  // equipamento amortizado, mês a mês (decisão híbrida — soma com despesa real).
  const a = eff.assumptions;
  let overheadCents = 0;
  for (const mf of monthList(fromMonth, toMonth)) {
    const mk = mf.slice(0, 7);
    const active = allocations.filter(
      (al) =>
        al.effective_from.slice(0, 7) <= mk &&
        (al.effective_to === null || al.effective_to.slice(0, 7) >= mk),
    );
    if (active.length === 0) continue;
    const fte = active.reduce((s, al) => s + Number(al.percent) / 100, 0);
    const heads = new Set(active.map((al) => al.member_id)).size;
    overheadCents += Math.round(
      fte * a.aiPerFteCents +
        heads * a.softwarePerHeadCents +
        heads * (a.equipCapexCents / a.equipLifeMonths),
    );
  }

  const dre = computeDre(
    {
      revenueCents: totals.revenueCents,
      directExpenseCents: totals.expenseCents,
      laborCents: totals.laborCents,
      overheadCents,
      months: months.length,
    },
    a,
  );

  const fpRows = (fpRes.data ?? []) as { fp_delivered: number; revenue_cents: number }[];

  return {
    projectId,
    name: (nameRes.data?.name as string) ?? projectId,
    months,
    totals,
    laborByMember,
    allocations,
    squadMemberIds: squad,
    sprintCount: sprintRes.count ?? 0,
    engagementType: (nameRes.data?.engagementType as string | null) ?? null,
    contract,
    fpDeliveredTotal: fpRows.reduce((s, r) => s + Number(r.fp_delivered), 0),
    fpRevenueCents: fpRows.reduce((s, r) => s + Number(r.revenue_cents), 0),
    overheadCents,
    dre,
    assumptions: a,
    assumptionsIsOverride: eff.isOverride,
  };
}
