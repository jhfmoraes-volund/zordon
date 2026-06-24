import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { getCurrentMember } from "@/lib/dal";
import { db } from "@/lib/db";
import { generateSprintGrid } from "@/lib/dal/generate-sprint-grid";
import { createClient } from "@/lib/supabase/server";
import type {
  Allocation,
  AllocationInput,
  AllocationItem,
  AllocationKind,
  Assumptions,
  AssumptionsInput,
  Category,
  CategoryMonthRow,
  CategoryTotal,
  Contract,
  ContractInput,
  ContractMonthOverride,
  ContractMonthOverrideInput,
  ContractMonthRow,
  ContractPeriod,
  ContractRosterMember,
  ContractClause,
  ContractClauseInput,
  Invoice,
  InvoiceInput,
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
  SprintLite,
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
  contractId?: string;
}): Promise<AllocationItem[]> {
  const { sb, fin } = await finance();
  // Lê a TABELA (não as views) — então inclui períodos encerrados E voided, que o
  // histórico do contrato precisa mostrar (views de billing/roster filtram voided).
  let q = fin
    .from("labor_allocation")
    .select("*")
    .order("effective_from", { ascending: false });
  if (filter.projectId) q = q.eq("project_id", filter.projectId);
  if (filter.memberId) q = q.eq("member_id", filter.memberId);
  if (filter.contractId) q = q.eq("contract_id", filter.contractId);
  const res = await q;
  if (res.error) throw new Error(res.error.message);
  return attachAllocationNames(sb, (res.data ?? []) as Allocation[]);
}

/**
 * Hard check (lança): percent fora de (0,100].
 * Soft check (retorna aviso, NÃO bloqueia): Σ% do membro em períodos que
 * sobrepõem o novo > 100. Over-allocation transitória acontece (ramp-up de
 * contrato, transição entre projetos) e estabiliza em semanas — então
 * registramos e avisamos, mas deixamos salvar. O resto da capacidade = overhead.
 */
async function checkAllocation(
  input: AllocationInput,
  excludeId?: string,
): Promise<string | null> {
  const kind = input.kind ?? "standing";
  // Spot: medido em HORAS (0 < h <= 160; coluna física segue `days`). Custo =
  // salário-mês ÷ 160h × horas. Não entra na conta de Σ% contínua.
  if (kind === "spot") {
    if (!(input.days != null && input.days > 0 && input.days <= 160))
      throw new Error("Participação pontual: horas deve estar entre 0 e 160");
    return null;
  }
  const percent = input.percent;
  if (!(percent != null && percent > 0 && percent <= 100))
    throw new Error("Percentual deve estar entre 0 e 100");
  const { fin } = await finance();
  const res = await fin
    .from("labor_allocation")
    .select("id, percent, effective_from, effective_to")
    .eq("member_id", input.memberId)
    .eq("kind", "standing"); // só standing soma no teto de %
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
  const prior = overlapping.reduce((s, a) => s + Number(a.percent), 0);
  const sum = prior + percent;
  return sum > 100
    ? `Alocação passa de 100% no período: ${prior}% já alocado + ${percent}% = ${sum}%. Salvo mesmo assim — ajuste quando a operação estabilizar.`
    : null;
}

function allocRow(input: AllocationInput, createdBy: string | null) {
  const kind = input.kind ?? "standing";
  return {
    member_id: input.memberId,
    project_id: input.projectId,
    kind,
    percent: kind === "spot" ? null : input.percent,
    days: kind === "spot" ? input.days : null,
    effective_from: input.effectiveFrom,
    effective_to: input.effectiveTo ?? null,
    note: input.note ?? null,
    contract_id: input.contractId ?? null,
    created_by: createdBy,
  };
}

export async function createAllocation(
  input: AllocationInput,
): Promise<{ allocation: Allocation; warning: string | null }> {
  const warning = await checkAllocation(input);
  const { sb, fin } = await finance();
  const res = await fin
    .from("labor_allocation")
    .insert(allocRow(input, await currentMemberId()))
    .select("*")
    .single();
  if (res.error) throw new Error(res.error.message);
  const allocation = res.data as Allocation;
  // D13: builder spot ganha ProjectAccess contributor PERMANENTE (acesso de
  // builder, não expira). Idempotente; nunca rebaixa um acesso já existente.
  if ((input.kind ?? "standing") === "spot") {
    const m = await sb.from("Member").select("userId").eq("id", input.memberId).maybeSingle();
    const userId = (m.data?.userId as string | null | undefined) ?? null;
    if (userId) {
      const existing = await sb
        .from("ProjectAccess")
        .select("id")
        .eq("projectId", input.projectId)
        .eq("userId", userId)
        .maybeSingle();
      if (!existing.data)
        await sb
          .from("ProjectAccess")
          .insert({ userId, projectId: input.projectId, role: "contributor" });
    }
  }
  // MAH-008: Emitir evento de criação
  const { recordAllocationCreated } = await import("@/lib/dal/member-movement-recorder");
  void recordAllocationCreated(allocation);
  return { allocation, warning };
}

/**
 * Edita campos de uma alocação.
 * - Standing (D2): valor/período do período contínuo é IMUTÁVEL. Permite só
 *   `note`, `effective_to` (fechar), `closed_by`. Mudar %: close/void + create.
 * - Spot: participação pontual, sem timeline de % a preservar. Além dos acima,
 *   permite corrigir `days` (horas) e `effectiveFrom` direto (caso de correção
 *   de typo, ex: 2h → 16h). `days`/`effectiveFrom` em standing são IGNORADOS.
 */
export async function updateAllocation(
  id: string,
  input: {
    note?: string | null;
    effectiveTo?: string | null;
    closedBy?: string | null;
    days?: number | null;
    effectiveFrom?: string;
  },
): Promise<Allocation> {
  const { fin } = await finance();
  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (input.note !== undefined) patch.note = input.note;
  if (input.effectiveTo !== undefined) patch.effective_to = input.effectiveTo;
  if (input.closedBy !== undefined) patch.closed_by = input.closedBy;
  // Correção direta de valor/início — só pra spot (standing é imutável).
  if (input.days !== undefined || input.effectiveFrom !== undefined) {
    const cur = await fin.from("labor_allocation").select("kind").eq("id", id).single();
    if (cur.error) throw new Error(cur.error.message);
    if ((cur.data as { kind: string }).kind === "spot") {
      if (input.days !== undefined) {
        if (!(input.days != null && input.days > 0 && input.days <= 160))
          throw new Error("Participação pontual: horas deve estar entre 0 e 160");
        patch.days = input.days;
      }
      if (input.effectiveFrom !== undefined) patch.effective_from = input.effectiveFrom;
    }
  }
  const res = await fin
    .from("labor_allocation")
    .update(patch)
    .eq("id", id)
    .select("*")
    .single();
  if (res.error) throw new Error(res.error.message);
  return res.data as Allocation;
}

/**
 * Fecha um período de alocação (seta effective_to + closed_by), respeitando D2.
 * Para mudar período: closeAllocation(old) + createAllocation(new).
 */
export async function closeAllocation(
  id: string,
  effectiveTo: string,
): Promise<Allocation> {
  const { fin } = await finance();
  // Lê before pra diff do evento
  const before = await fin.from("labor_allocation").select("*").eq("id", id).single();
  if (before.error) throw new Error(before.error.message);
  const after = await updateAllocation(id, {
    effectiveTo,
    closedBy: await currentMemberId(),
  });
  // MAH-008: Emitir evento de close
  const { recordAllocationClosed } = await import("@/lib/dal/member-movement-recorder");
  void recordAllocationClosed(before.data as Allocation, after);
  return after;
}

/**
 * Marca uma alocação como erro (void), com motivo + autor (MAH-004 D4).
 * O período some da billing/roster (views filtr am voided_at IS NULL).
 * Reversível via restoreAllocation.
 */
export async function voidAllocation(
  id: string,
  reason: string,
): Promise<Allocation> {
  if (!reason?.trim()) throw new Error("Remoção requer motivo");
  const { fin } = await finance();
  // Lê o before pra emitir diff no evento
  const before = await fin.from("labor_allocation").select("*").eq("id", id).single();
  if (before.error) throw new Error(before.error.message);
  const res = await fin
    .from("labor_allocation")
    .update({
      voided_at: new Date().toISOString(),
      voided_reason: reason.trim(),
      voided_by: await currentMemberId(),
      updated_at: new Date().toISOString(),
    })
    .eq("id", id)
    .select("*")
    .single();
  if (res.error) throw new Error(res.error.message);
  const after = res.data as Allocation;
  // MAH-008: Emitir evento de void
  const { recordAllocationVoided } = await import("@/lib/dal/member-movement-recorder");
  void recordAllocationVoided(before.data as Allocation, after);
  return after;
}

/**
 * Restaura alocação marcada como erro (limpa void_*, MAH-004 D5).
 * Reaparece nas views de billing/roster.
 */
export async function restoreAllocation(id: string): Promise<Allocation> {
  const { fin } = await finance();
  const res = await fin
    .from("labor_allocation")
    .update({
      voided_at: null,
      voided_reason: null,
      voided_by: null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", id)
    .select("*")
    .single();
  if (res.error) throw new Error(res.error.message);
  const allocation = res.data as Allocation;
  // MAH-008: Emitir evento de restore
  const { recordAllocationRestored } = await import("@/lib/dal/member-movement-recorder");
  void recordAllocationRestored(allocation);
  return allocation;
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
    id: String(r.id),
    projectId: String(r.project_id),
    label: String(r.label),
    seq: Number(r.seq),
    status: (r.status as Contract["status"]) ?? "active",
    effectiveFrom: String(r.effective_from),
    effectiveTo: (r.effective_to as string | null) ?? null,
    billingType: r.billing_type === "fixed_scope" ? "fixed_scope" : "squad",
    monthlyFeeCents: num(r.monthly_fee_cents),
    billingCount: num(r.billing_count),
    totalValueCents: num(r.total_value_cents),
    pricePerFpCents: num(r.price_per_fp_cents), // derivado (coluna GENERATED)
    contractedFp: num(r.contracted_fp),
    contractedSprints: num(r.contracted_sprints),
    note: (r.note as string | null) ?? null,
    warranty: (r.warranty as string | null) ?? null,
    proposalRef: (r.proposal_ref as string | null) ?? null,
    provenance: (r.provenance as Record<string, unknown>) ?? {},
  };
}

/** Contratos do projeto, ordenados por vigência (seq crescente). */
export async function listContracts(projectId: string): Promise<Contract[]> {
  const { fin } = await finance();
  const res = await fin
    .from("contract")
    .select("*")
    .eq("project_id", projectId)
    .order("seq", { ascending: true });
  if (res.error) throw new Error(res.error.message);
  return ((res.data ?? []) as Record<string, unknown>[]).map(mapContract);
}

/**
 * Períodos legíveis por quem vê o projeto (Slice 3 · view v_contract_period).
 * A view filtra por can_view_project OR is_admin (boundary no DB) e projeta SÓ
 * período/identidade — sem valores. Usado fora do app admin (tab do projeto).
 */
export async function listContractPeriods(projectId: string): Promise<ContractPeriod[]> {
  const { fin } = await finance();
  const res = await fin
    .from("v_contract_period")
    .select("*")
    .eq("project_id", projectId)
    .order("seq", { ascending: true });
  if (res.error) throw new Error(res.error.message);
  return ((res.data ?? []) as Record<string, unknown>[]).map((r) => ({
    contractId: String(r.contract_id),
    projectId: String(r.project_id),
    label: String(r.label),
    seq: Number(r.seq),
    effectiveFrom: String(r.effective_from),
    effectiveTo: (r.effective_to as string | null) ?? null,
    billingType: (r.billing_type as ContractPeriod["billingType"]) ?? "squad",
    status: (r.status as ContractPeriod["status"]) ?? "active",
  }));
}

/**
 * Roster de contrato PM-safe (app Contratos). Lê finance.v_contract_roster, cuja
 * fronteira (can_view_project OR is_admin) já filtra as linhas; nunca trafega valor.
 */
export async function listContractRoster(
  projectId: string,
): Promise<ContractRosterMember[]> {
  const { fin } = await finance();
  const res = await fin
    .from("v_contract_roster")
    .select("*")
    .eq("project_id", projectId)
    .order("member_position", { ascending: true })
    .order("member_name", { ascending: true });
  if (res.error) throw new Error(res.error.message);
  return ((res.data ?? []) as Record<string, unknown>[]).map((r) => ({
    allocationId: String(r.allocation_id),
    contractId: String(r.contract_id),
    memberId: String(r.member_id),
    memberName: String(r.member_name),
    memberPosition: (r.member_position as string | null) ?? null,
    kind: (r.kind as AllocationKind) ?? "standing",
    percent: r.percent != null ? Number(r.percent) : null,
    days: r.days != null ? Number(r.days) : null,
    effectiveFrom: String(r.effective_from),
    effectiveTo: (r.effective_to as string | null) ?? null,
  }));
}

/** Vigências não podem se sobrepor no mesmo projeto (1 contrato por período). */
async function validateContract(
  projectId: string,
  input: ContractInput,
  excludeId?: string,
): Promise<Contract[]> {
  if (!input.label?.trim()) throw new Error("Contrato precisa de um rótulo");
  if (!input.effectiveFrom) throw new Error("Contrato precisa de início de vigência");
  if (input.effectiveTo && input.effectiveTo < input.effectiveFrom)
    throw new Error("Fim da vigência é anterior ao início");
  const existing = await listContracts(projectId);
  const others = existing.filter((c) => c.id !== excludeId);
  const clash = others.find((c) =>
    periodsOverlap(input.effectiveFrom, input.effectiveTo ?? null, c.effectiveFrom, c.effectiveTo),
  );
  if (clash)
    throw new Error(
      `Vigência sobrepõe o contrato "${clash.label}" (${clash.effectiveFrom} → ${clash.effectiveTo ?? "atual"})`,
    );
  return existing;
}

/** Transições válidas do lifecycle do contrato (D1). */
const CONTRACT_STATUS_NEXT: Record<Contract["status"], Contract["status"][]> = {
  proposed: ["proposed", "active", "declined"],
  active: ["active", "ended"],
  ended: ["ended"],
  declined: ["declined"],
};

function toContractRow(input: ContractInput) {
  return {
    label: input.label.trim(),
    // status omitido no create → cai no DEFAULT 'active' do schema.
    ...(input.status ? { status: input.status } : {}),
    effective_from: input.effectiveFrom,
    effective_to: input.effectiveTo ?? null,
    billing_type: input.billingType,
    monthly_fee_cents: input.monthlyFeeCents ?? null,
    billing_count: input.billingCount ?? null,
    total_value_cents: input.totalValueCents ?? null, // preço/FP é derivado (GENERATED) — não gravar
    contracted_fp: input.contractedFp ?? null,
    contracted_sprints: input.contractedSprints ?? null,
    note: input.note ? input.note.slice(0, 500) : null, // espelha o maxLength=500 do form (guard server-side)
    warranty: input.warranty ?? null,
    proposal_ref: input.proposalRef ?? null,
  };
}

/**
 * Seed automático da grade de sprints na ATIVAÇÃO do contrato (uma vez só, na
 * transição pra "active + tem fim de vigência"). Best-effort: roda via
 * service-role (mesmo caminho do endpoint manual) e NUNCA derruba a operação
 * do contrato. As datas do projeto já vêm sincronizadas da vigência pelo
 * trigger contract_sync_project_dates, então generateSprintGrid lê o prazo já
 * atualizado. `missing_dates` é esperado quando outro contrato aberto zera o
 * Project.endDate — nesse caso só não semeia. Daí em diante o PM é dono da grade.
 */
async function maybeSeedSprints(projectId: string): Promise<void> {
  try {
    const actorMemberId = await currentMemberId();
    const res = await generateSprintGrid(db(), projectId, { actorMemberId });
    if (!res.ok && res.reason !== "missing_dates") {
      console.error("[finance] seed sprints on activation failed", res);
    }
  } catch (e) {
    console.error("[finance] seed sprints on activation threw", e);
  }
}

export async function createContract(
  projectId: string,
  input: ContractInput,
): Promise<Contract> {
  const existing = await validateContract(projectId, input);
  const seq = existing.reduce((mx, c) => Math.max(mx, c.seq), 0) + 1;
  const { fin } = await finance();
  const res = await fin
    .from("contract")
    .insert({
      ...toContractRow(input),
      project_id: projectId,
      seq,
      created_by: await currentMemberId(),
    })
    .select("*")
    .single();
  if (res.error) throw new Error(res.error.message);
  const created = mapContract(res.data);
  // Criado já ativo + com fim de vigência → semeia a grade (stub today→null não
  // dispara: effectiveTo nulo). O trigger de datas já rodou no insert acima.
  if (created.status === "active" && created.effectiveTo != null) {
    await maybeSeedSprints(projectId);
  }
  return created;
}

export async function updateContract(id: string, input: ContractInput): Promise<Contract> {
  const { fin } = await finance();
  const cur = await fin
    .from("contract")
    .select("project_id, status, effective_to")
    .eq("id", id)
    .maybeSingle();
  if (cur.error) throw new Error(cur.error.message);
  if (!cur.data) throw new Error("Contrato não encontrado");
  const curRow = cur.data as {
    project_id: string;
    status: Contract["status"];
    effective_to: string | null;
  };
  // Máquina de estados: bloqueia transição inválida (ex.: ended→active).
  if (input.status && input.status !== curRow.status) {
    const allowed = CONTRACT_STATUS_NEXT[curRow.status] ?? [];
    if (!allowed.includes(input.status))
      throw new Error(`Transição de status inválida: ${curRow.status} → ${input.status}`);
  }
  await validateContract(String(curRow.project_id), input, id);
  const res = await fin
    .from("contract")
    .update({ ...toContractRow(input), updated_at: new Date().toISOString() })
    .eq("id", id)
    .select("*")
    .single();
  if (res.error) throw new Error(res.error.message);
  const updated = mapContract(res.data);
  // Seed na TRANSIÇÃO pra "active + tem fim" (stub active→null que ganha
  // effectiveTo, ou proposed→active já com fim). Não re-dispara em saves de um
  // contrato que já estava active+bounded — evita ressuscitar sprint que o PM
  // apagou.
  const wasActiveBounded =
    curRow.status === "active" && curRow.effective_to != null;
  const isActiveBounded =
    updated.status === "active" && updated.effectiveTo != null;
  if (isActiveBounded && !wasActiveBounded) {
    await maybeSeedSprints(String(curRow.project_id));
  }
  return updated;
}

export async function deleteContract(id: string): Promise<void> {
  const { fin } = await finance();
  const res = await fin.from("contract").delete().eq("id", id);
  if (res.error) throw new Error(res.error.message);
}

/**
 * "Ganhar proposta" (D1/F1.7): contrato proposed→active e, se o projeto ainda
 * está na fase commercial, avança pra immersion registrando o ProjectPhaseEvent.
 * Uma transição só — sem re-digitar datas/valor/equipe (já estão na proposta).
 */
export async function winContract(id: string): Promise<Contract> {
  const { sb, fin } = await finance();
  const cur = await fin.from("contract").select("project_id, status").eq("id", id).maybeSingle();
  if (cur.error) throw new Error(cur.error.message);
  if (!cur.data) throw new Error("Contrato não encontrado");
  const row = cur.data as { project_id: string; status: Contract["status"] };
  if (row.status !== "proposed")
    throw new Error(`Só uma proposta pode ser ganha (status atual: ${row.status})`);

  const upd = await fin
    .from("contract")
    .update({ status: "active", updated_at: new Date().toISOString() })
    .eq("id", id)
    .select("*")
    .single();
  if (upd.error) throw new Error(upd.error.message);

  // Fase commercial→immersion (só se ainda commercial), com log de transição.
  const proj = await sb.from("Project").select("phase").eq("id", row.project_id).maybeSingle();
  if (proj.data?.phase === "commercial") {
    await sb
      .from("Project")
      .update({ phase: "immersion", phaseChangedAt: new Date().toISOString() })
      .eq("id", row.project_id);
    await sb.from("ProjectPhaseEvent").insert({
      projectId: row.project_id,
      fromPhase: "commercial",
      toPhase: "immersion",
      changedBy: await currentMemberId(),
    });
  }
  const won = mapContract(upd.data);
  // Ganhou a proposta com fim de vigência definido → semeia a grade de sprints
  // do prazo (uma vez, aqui). O trigger de datas já rodou no update de status.
  if (won.effectiveTo != null) {
    await maybeSeedSprints(row.project_id);
  }
  return won;
}

// ─── Override de mês do contrato (valor especial de 1 mês) ──────────────────

function mapOverride(r: Record<string, unknown>): ContractMonthOverride {
  return {
    id: String(r.id),
    contractId: String(r.contract_id),
    month: String(r.month),
    amountCents: Number(r.amount_cents),
    note: (r.note as string | null) ?? null,
  };
}

export async function listContractOverrides(contractId: string): Promise<ContractMonthOverride[]> {
  const { fin } = await finance();
  const res = await fin
    .from("contract_month_override")
    .select("*")
    .eq("contract_id", contractId)
    .order("month", { ascending: true });
  if (res.error) throw new Error(res.error.message);
  return ((res.data ?? []) as Record<string, unknown>[]).map(mapOverride);
}

/** Upsert por (contrato, mês): adicionar um mês que já tem override substitui o valor. */
export async function upsertContractOverride(
  contractId: string,
  input: ContractMonthOverrideInput,
): Promise<ContractMonthOverride> {
  if (!(input.amountCents >= 0)) throw new Error("Valor do override não pode ser negativo");
  if (!input.month) throw new Error("Mês do override é obrigatório");
  const month = `${input.month.slice(0, 7)}-01`;
  const { fin } = await finance();
  const lookup = await fin
    .from("contract_month_override")
    .select("id")
    .eq("contract_id", contractId)
    .eq("month", month)
    .maybeSingle();
  const row = { amount_cents: input.amountCents, note: input.note ?? null };
  if (lookup.data) {
    const res = await fin
      .from("contract_month_override")
      .update({ ...row, updated_at: new Date().toISOString() })
      .eq("id", (lookup.data as { id: string }).id)
      .select("*")
      .single();
    if (res.error) throw new Error(res.error.message);
    return mapOverride(res.data);
  }
  const res = await fin
    .from("contract_month_override")
    .insert({ ...row, contract_id: contractId, month, created_by: await currentMemberId() })
    .select("*")
    .single();
  if (res.error) throw new Error(res.error.message);
  return mapOverride(res.data);
}

export async function deleteContractOverride(id: string): Promise<void> {
  const { fin } = await finance();
  const res = await fin.from("contract_month_override").delete().eq("id", id);
  if (res.error) throw new Error(res.error.message);
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
  contractId?: string | null,
): Promise<ProjectDetail> {
  const { sb, fin } = await finance();
  const { from, to } = monthBounds(fromMonth, toMonth);

  const [monthsRes, cmRes, laborRes, allocLaborRes, nameRes, allocations, squad, eff, sprintRes, contracts, fpRes, clauses, invoices] =
    await Promise.all([
    fin
      .from("v_project_month")
      .select("*")
      .eq("project_id", projectId)
      .gte("month", from)
      .lte("month", to)
      .order("month", { ascending: true }),
    // Fato POR CONTRATO — usado quando um contrato está escopado (atribui
    // receita/equipe/despesa ao contrato, sem vazar de janela de mês). SEM
    // recorte de janela: o escopo de contrato mostra a economia COMPLETA do
    // contrato (ex.: equipe alocada antes do 1º faturamento ainda conta).
    fin
      .from("v_contract_month")
      .select("*")
      .eq("project_id", projectId)
      .order("month", { ascending: true }),
    fin
      .from("v_project_member_labor_month")
      .select("member_id, labor_cents")
      .eq("project_id", projectId)
      .gte("month", from)
      .lte("month", to),
    // Custo PRO-RATA por alocação×mês (base única). Sem janela: cada linha de
    // equipe mostra o custo somado do SEU prazo (a vigência da alocação).
    fin
      .from("v_allocation_labor_month")
      .select("allocation_id, labor_cents")
      .eq("project_id", projectId),
    sb.from("Project").select("name, engagementType").eq("id", projectId).maybeSingle(),
    listAllocations({ projectId }),
    squadMemberIds(sb, projectId),
    getEffectiveAssumptions(projectId),
    sb
      .from("Sprint")
      .select("id, name, startDate, endDate, status")
      .eq("projectId", projectId)
      .order("startDate", { ascending: true }),
    listContracts(projectId),
    fin
      .from("v_fp_delivery_month")
      .select("fp_delivered, revenue_cents")
      .eq("project_id", projectId)
      .gte("month", from)
      .lte("month", to),
    listClausesByProject(projectId),
    listInvoices({ projectId }),
  ]);
  if (monthsRes.error) throw new Error(monthsRes.error.message);
  if (cmRes.error) throw new Error(cmRes.error.message);
  if (laborRes.error) throw new Error(laborRes.error.message);
  if (allocLaborRes.error) throw new Error(allocLaborRes.error.message);

  // Escopo de contrato: série mensal vem do fato POR CONTRATO (sem vazamento de
  // janela — ex.: a mensalidade do squad não aparece no escopo da encomenda que
  // só encosta no mesmo mês de calendário). Global: usa v_project_month.
  const months: ProjectMonthPoint[] = contractId
    ? ((cmRes.data ?? []) as ContractMonthRow[])
        .filter((r) => r.contract_id === contractId)
        .map((r) => ({
          month: r.month,
          revenue_cents: Number(r.revenue_cents),
          expense_cents: Number(r.expense_cents),
          labor_cents: Number(r.labor_cents),
          margin_direct_cents: Number(r.revenue_cents) - Number(r.expense_cents),
          margin_team_cents: Number(r.revenue_cents) - Number(r.expense_cents) - Number(r.labor_cents),
        }))
    : ((monthsRes.data ?? []) as ProjectMonthPoint[]);
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

  // Custo pro-rata SOMADO por alocação (o prazo da linha de equipe) — base
  // única `v_allocation_labor_month`, consistente com a equipe da DRE.
  const allocLaborMap = new Map<string, number>();
  for (const r of (allocLaborRes.data ?? []) as { allocation_id: string; labor_cents: number }[])
    allocLaborMap.set(r.allocation_id, (allocLaborMap.get(r.allocation_id) ?? 0) + Number(r.labor_cents));
  const allocationsWithLabor = allocations.map((al) => ({
    ...al,
    laborCents: allocLaborMap.get(al.id) ?? 0,
  }));

  // Overhead por pessoa (premissas × alocação): IA/FTE + software/cabeça +
  // equipamento amortizado, mês a mês (decisão híbrida — soma com despesa real).
  const a = eff.assumptions;
  // Escopo de contrato: overhead conta só a equipe alocada NESTE contrato.
  const overheadAllocations = contractId
    ? allocations.filter((al) => al.contract_id === contractId)
    : allocations;
  // Escopado: itera os meses atribuídos ao contrato (full period, sem janela).
  // Global: a janela do ano.
  const overheadMonths = contractId
    ? months.map((m) => m.month)
    : monthList(fromMonth, toMonth);
  let overheadCents = 0;
  for (const mf of overheadMonths) {
    const mk = mf.slice(0, 7);
    const active = overheadAllocations.filter(
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
  const sprints = (sprintRes.data ?? []) as SprintLite[];

  return {
    projectId,
    name: (nameRes.data?.name as string) ?? projectId,
    months,
    totals,
    laborByMember,
    allocations: allocationsWithLabor,
    squadMemberIds: squad,
    sprints,
    sprintCount: sprints.length,
    engagementType: (nameRes.data?.engagementType as string | null) ?? null,
    contracts,
    clauses,
    invoices,
    fpDeliveredTotal: fpRows.reduce((s, r) => s + Number(r.fp_delivered), 0),
    fpRevenueCents: fpRows.reduce((s, r) => s + Number(r.revenue_cents), 0),
    overheadCents,
    dre,
    assumptions: a,
    assumptionsIsOverride: eff.isOverride,
  };
}

// ─── Cláusulas do contrato (1-N) ────────────────────────────────────────────

function mapClause(r: Record<string, unknown>): ContractClause {
  return {
    id: String(r.id),
    contractId: String(r.contract_id),
    kind: (r.kind as ContractClause["kind"]) ?? "other",
    text: String(r.text),
    sort: Number(r.sort ?? 0),
    source: (r.source as string) ?? "manual",
  };
}

export async function listClauses(contractId: string): Promise<ContractClause[]> {
  const { fin } = await finance();
  const res = await fin
    .from("contract_clause")
    .select("*")
    .eq("contract_id", contractId)
    .order("sort", { ascending: true });
  if (res.error) throw new Error(res.error.message);
  return ((res.data ?? []) as Record<string, unknown>[]).map(mapClause);
}

/** Todas as cláusulas dos contratos de um projeto (1 query; agrupar por contractId na UI). */
export async function listClausesByProject(projectId: string): Promise<ContractClause[]> {
  const { fin } = await finance();
  const cs = await fin.from("contract").select("id").eq("project_id", projectId);
  const ids = ((cs.data ?? []) as { id: string }[]).map((c) => c.id);
  if (!ids.length) return [];
  const res = await fin
    .from("contract_clause")
    .select("*")
    .in("contract_id", ids)
    .order("sort", { ascending: true });
  if (res.error) throw new Error(res.error.message);
  return ((res.data ?? []) as Record<string, unknown>[]).map(mapClause);
}

export async function createClause(input: ContractClauseInput): Promise<ContractClause> {
  if (!input.text?.trim()) throw new Error("Cláusula precisa de texto");
  const { fin } = await finance();
  const res = await fin
    .from("contract_clause")
    .insert({
      contract_id: input.contractId,
      kind: input.kind ?? "other",
      text: input.text.trim(),
      sort: input.sort ?? 0,
      source: "manual",
    })
    .select("*")
    .single();
  if (res.error) throw new Error(res.error.message);
  return mapClause(res.data);
}

export async function updateClause(
  id: string,
  changes: Partial<Pick<ContractClauseInput, "kind" | "text" | "sort">>,
): Promise<ContractClause> {
  const { fin } = await finance();
  const row: Record<string, unknown> = {};
  if (changes.kind !== undefined) row.kind = changes.kind;
  if (changes.text !== undefined) row.text = changes.text.trim();
  if (changes.sort !== undefined) row.sort = changes.sort;
  const res = await fin.from("contract_clause").update(row).eq("id", id).select("*").single();
  if (res.error) throw new Error(res.error.message);
  return mapClause(res.data);
}

export async function deleteClause(id: string): Promise<void> {
  const { fin } = await finance();
  const res = await fin.from("contract_clause").delete().eq("id", id);
  if (res.error) throw new Error(res.error.message);
}

// ─── Invoice / NF (cobrança operacional; Q4: NÃO toca receita) ──────────────

function mapInvoice(r: Record<string, unknown>): Invoice {
  const num = (v: unknown) => (v === null || v === undefined ? null : Number(v));
  const str = (v: unknown) => (v === null || v === undefined ? null : String(v));
  return {
    id: String(r.id),
    contractId: String(r.contract_id),
    competenceMonth: String(r.competence_month),
    amountCents: Number(r.amount_cents),
    receivedNetCents: num(r.received_net_cents),
    number: str(r.number),
    status: (r.status as Invoice["status"]) ?? "pending",
    issuedAt: str(r.issued_at),
    receivedAt: str(r.received_at),
    dueAt: str(r.due_at),
    conditionKind: (r.condition_kind as Invoice["conditionKind"]) ?? null,
    conditionMet: Boolean(r.condition_met),
    createdBy: str(r.created_by),
    provenance: (r.provenance as Record<string, unknown>) ?? {},
  };
}

export async function listInvoices(filter: {
  contractId?: string;
  projectId?: string;
}): Promise<Invoice[]> {
  const { fin } = await finance();
  let q = fin.from("invoice").select("*").order("competence_month", { ascending: true });
  if (filter.contractId) q = q.eq("contract_id", filter.contractId);
  if (filter.projectId) {
    const cs = await fin.from("contract").select("id").eq("project_id", filter.projectId);
    const ids = ((cs.data ?? []) as { id: string }[]).map((c) => c.id);
    if (!ids.length) return [];
    q = q.in("contract_id", ids);
  }
  const res = await q;
  if (res.error) throw new Error(res.error.message);
  return ((res.data ?? []) as Record<string, unknown>[]).map(mapInvoice);
}

/** Linha do banco a partir de campos presentes (PATCH-safe; mês normalizado p/ 1º dia). */
function invoiceRow(input: Partial<InvoiceInput>) {
  const month = input.competenceMonth ? `${input.competenceMonth.slice(0, 7)}-01` : undefined;
  const row: Record<string, unknown> = {};
  if (input.contractId !== undefined) row.contract_id = input.contractId;
  if (month !== undefined) row.competence_month = month;
  if (input.amountCents !== undefined) row.amount_cents = input.amountCents;
  if (input.receivedNetCents !== undefined) row.received_net_cents = input.receivedNetCents;
  if (input.number !== undefined) row.number = input.number;
  if (input.status !== undefined) row.status = input.status;
  if (input.issuedAt !== undefined) row.issued_at = input.issuedAt;
  if (input.receivedAt !== undefined) row.received_at = input.receivedAt;
  if (input.dueAt !== undefined) row.due_at = input.dueAt;
  if (input.conditionKind !== undefined) row.condition_kind = input.conditionKind;
  if (input.conditionMet !== undefined) row.condition_met = input.conditionMet;
  return row;
}

export async function createInvoice(input: InvoiceInput): Promise<Invoice> {
  if (!input.contractId) throw new Error("NF precisa de contrato");
  if (!input.competenceMonth) throw new Error("NF precisa de mês de competência");
  if (!(input.amountCents >= 0)) throw new Error("Valor da NF não pode ser negativo");
  const { fin } = await finance();
  const res = await fin
    .from("invoice")
    .insert({ ...invoiceRow(input), created_by: await currentMemberId() })
    .select("*")
    .single();
  if (res.error) throw new Error(res.error.message);
  return mapInvoice(res.data);
}

export async function updateInvoice(id: string, changes: Partial<InvoiceInput>): Promise<Invoice> {
  const { fin } = await finance();
  const res = await fin
    .from("invoice")
    .update({ ...invoiceRow(changes), updated_at: new Date().toISOString() })
    .eq("id", id)
    .select("*")
    .single();
  if (res.error) throw new Error(res.error.message);
  return mapInvoice(res.data);
}

export async function deleteInvoice(id: string): Promise<void> {
  const { fin } = await finance();
  const res = await fin.from("invoice").delete().eq("id", id);
  if (res.error) throw new Error(res.error.message);
}
