import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { getCurrentMember } from "@/lib/dal";
import { createClient } from "@/lib/supabase/server";
import type {
  Category,
  CategoryMonthRow,
  CategoryTotal,
  Entry,
  EntryInput,
  EntryListItem,
  OrgMonthRow,
  OverviewResponse,
  ProjectFinanceRow,
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

  const [orgRes, catRes] = await Promise.all([
    fin
      .from("v_org_month")
      .select("*")
      .gte("month", from)
      .lte("month", to)
      .order("month", { ascending: true }),
    fin.from("v_category_month").select("*").gte("month", from).lte("month", to),
  ]);
  if (orgRes.error) throw new Error(orgRes.error.message);
  if (catRes.error) throw new Error(catRes.error.message);

  const months = (orgRes.data ?? []) as OrgMonthRow[];
  const catRows = (catRes.data ?? []) as CategoryMonthRow[];

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
