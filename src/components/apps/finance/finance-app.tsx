"use client";

/**
 * App Finanças — superfície do Overview (admin-only).
 *
 * Análise de receita × despesa × margem da operação, no padrão visual do
 * finco (KPIs → tendência → categorias → margem por projeto), reescrito na
 * linguagem console do Zordon. Lê de /api/finance/{overview,projects}; clicar
 * numa categoria abre o drill (itens + CRUD). + Receita/Despesa lançam.
 *
 * Plano: docs/features/finance/finance-app-plan.md
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Bar,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
} from "recharts";
import { Banknote, Receipt, SlidersHorizontal, TrendingUp, Users, Wallet } from "lucide-react";

import { AppFileList, AppFileRow, AppFileBadge } from "@/components/apps/app-file-list";
import { Button } from "@/components/ui/button";
import { brlFromCents, pct } from "@/lib/format-currency";
import type {
  Category,
  CategoryTotal,
  FinanceKind,
  MemberRef,
  OrgMonthRow,
  OverviewResponse,
  ProjectFinanceRow,
  ProjectsResponse,
} from "@/lib/finance/types";
import { cn } from "@/lib/utils";
import { FinanceAssumptionsForm } from "./finance-assumptions-form";
import { FinanceCategorySheet } from "./finance-category-sheet";
import { FinanceEntryForm } from "./finance-entry-form";
import { FinanceProjectView } from "./finance-project-view";

type NamedRef = { id: string; name: string };

type FinanceData = {
  ready: boolean;
  months: OrgMonthRow[];
  categories: CategoryTotal[];
  totals: OverviewResponse["totals"];
  teamCost: OverviewResponse["teamCost"];
  projects: ProjectFinanceRow[];
};

const EMPTY: FinanceData = {
  ready: false,
  months: [],
  categories: [],
  totals: { revenueCents: 0, expenseCents: 0, netCents: 0 },
  teamCost: { compCents: 0, allocatedCents: 0, overheadCents: 0 },
  projects: [],
};

function monthLabel(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString("pt-BR", { month: "short", timeZone: "UTC" }).replace(".", "");
}

/** Busca pura (sem setState) — usada pelo effect (.then) e pelo reload. */
async function fetchFinance(yr: number): Promise<FinanceData> {
  const from = `${yr}-01`;
  const to = `${yr}-12`;
  const [ov, pr] = await Promise.all([
    fetch(`/api/finance/overview?from=${from}&to=${to}`).then((r) =>
      r.ok ? (r.json() as Promise<OverviewResponse>) : null,
    ),
    fetch(`/api/finance/projects?from=${from}&to=${to}`).then((r) =>
      r.ok ? (r.json() as Promise<ProjectsResponse>) : null,
    ),
  ]);
  if (!ov && !pr) return EMPTY;
  return {
    ready: true,
    months: ov?.months ?? [],
    categories: ov?.categories ?? [],
    totals: ov?.totals ?? EMPTY.totals,
    teamCost: ov?.teamCost ?? EMPTY.teamCost,
    projects: pr?.projects ?? [],
  };
}

export function FinanceApp({
  onSelectedProjectChange,
  initialProjectId,
}: {
  /** Reporta o projeto aberto pro host (vira o subtítulo da janela do canvas). */
  onSelectedProjectChange?: (name: string | null) => void;
  /** Deep-link (?fp=): abre direto este projeto (handoff pós-criação). */
  initialProjectId?: string | null;
} = {}) {
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [data, setData] = useState<FinanceData | null>(null);

  // Insumos pros forms/drill (carregados uma vez).
  const [categories, setCategories] = useState<Category[]>([]);
  const [projects, setProjects] = useState<NamedRef[]>([]);
  const [members, setMembers] = useState<MemberRef[]>([]);

  const [drill, setDrill] = useState<CategoryTotal | null>(null);
  // Projeto aberto no hub (canvas) — substitui o antigo modal de drill.
  const [selected, setSelected] = useState<{ id: string; name: string } | null>(null);
  const [appForm, setAppForm] = useState<{ kind: FinanceKind; key: number } | null>(null);
  const [assumptionsOpen, setAssumptionsOpen] = useState(false);

  // Ao desmontar (app fechado), zera o subtítulo da janela — senão "Overview"
  // fica preso no nome de um projeto que não está mais aberto.
  useEffect(() => {
    return () => onSelectedProjectChange?.(null);
  }, [onSelectedProjectChange]);

  const openProject = useCallback(
    (p: { id: string; name: string }) => {
      setSelected(p);
      onSelectedProjectChange?.(p.name);
    },
    [onSelectedProjectChange],
  );
  const backToOverview = useCallback(() => {
    setSelected(null);
    onSelectedProjectChange?.(null);
  }, [onSelectedProjectChange]);

  useEffect(() => {
    let cancelled = false;
    fetchFinance(year).then((d) => {
      if (!cancelled) setData(d);
    });
    return () => {
      cancelled = true;
    };
  }, [year]);

  const reload = useCallback(() => {
    void fetchFinance(year).then(setData);
  }, [year]);

  // Insumos: categorias (finance) + projetos + membros.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [cats, projs, mems] = await Promise.all([
        fetch("/api/finance/categories").then((r) => (r.ok ? r.json() : null)),
        fetch("/api/projects").then((r) => (r.ok ? r.json() : null)),
        fetch("/api/members").then((r) => (r.ok ? r.json() : null)),
      ]);
      if (cancelled) return;
      if (cats?.categories) setCategories(cats.categories as Category[]);
      if (Array.isArray(projs)) {
        const list = projs.map((p: NamedRef) => ({ id: p.id, name: p.name }));
        setProjects(list);
        // Deep-link (?fp=): abre o projeto direto (handoff de "configurar no S&OP").
        if (initialProjectId) {
          const hit = list.find((p) => p.id === initialProjectId);
          if (hit) openProject(hit);
        }
      }
      if (Array.isArray(mems))
        setMembers(
          mems.map(
            (m: { id: string; name: string; position?: string | null; isExternal?: boolean }) => ({
              id: m.id,
              name: m.name,
              position: m.position ?? null,
              isExternal: !!m.isExternal,
            }),
          ),
        );
    })();
    return () => {
      cancelled = true;
    };
  }, [initialProjectId, openProject]);

  const totals = data?.totals ?? EMPTY.totals;
  const marginPct = totals.revenueCents > 0 ? totals.netCents / totals.revenueCents : null;
  const compCents = useMemo(
    () =>
      (data?.categories ?? [])
        .filter((c) => c.slug === "salarios")
        .reduce((s, c) => s + c.amountCents, 0),
    [data],
  );

  const chartData = useMemo(
    () =>
      (data?.months ?? []).map((m) => ({
        month: monthLabel(m.month),
        receita: m.revenue_cents / 100,
        despesa: m.expense_cents / 100,
        margem: m.net_cents / 100,
      })),
    [data],
  );

  const loading = data === null;
  const hasData = (data?.months.length ?? 0) > 0;

  // Projeto aberto → o hub financeiro toma a janela inteira do canvas (read).
  // Remontado por `key` pra resetar escopo/fetch ao trocar de projeto.
  if (selected) {
    return (
      <FinanceProjectView
        key={selected.id}
        projectId={selected.id}
        projectName={selected.name}
        year={year}
        members={members}
        onChanged={reload}
        onBack={backToOverview}
      />
    );
  }

  return (
    <div className="space-y-4">
      {/* ─── Header: período + ações ─────────────────────────────────── */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <select
          value={year}
          onChange={(e) => setYear(Number(e.target.value))}
          className="h-8 rounded-md border bg-background px-2 text-sm"
          aria-label="Ano"
        >
          {[now.getFullYear(), now.getFullYear() - 1, now.getFullYear() - 2].map((y) => (
            <option key={y} value={y}>
              {y}
            </option>
          ))}
        </select>
        <div className="flex items-center gap-1.5">
          <Button
            size="sm"
            variant="outline"
            onClick={() => setAppForm({ kind: "revenue", key: Date.now() })}
          >
            <Banknote className="size-3.5" /> Receita
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => setAppForm({ kind: "expense", key: Date.now() })}
          >
            <Receipt className="size-3.5" /> Despesa
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => setAssumptionsOpen(true)}
            title="Premissas: impostos, SG&A, custos por pessoa"
          >
            <SlidersHorizontal className="size-3.5" /> Premissas
          </Button>
        </div>
      </div>

      {/* ─── KPIs ────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
        <Kpi label="Receita" icon={Banknote} value={brlFromCents(totals.revenueCents)} tone="income" />
        <Kpi label="Despesa" icon={Receipt} value={brlFromCents(totals.expenseCents)} tone="expense" />
        <Kpi
          label="Margem"
          icon={TrendingUp}
          value={brlFromCents(totals.netCents)}
          sub={`${pct(marginPct)} da receita`}
          tone={totals.netCents >= 0 ? "income" : "expense"}
        />
        <Kpi label="Burn (comp)" icon={Wallet} value={brlFromCents(compCents)} tone="muted" />
      </div>

      {/* ─── Tendência ───────────────────────────────────────────────── */}
      <div className="rounded-md border p-3">
        <div className="mb-2 flex items-center justify-between px-1">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            {year} — receita × despesa × margem
          </p>
          <div className="flex items-center gap-3 text-[10px] text-muted-foreground">
            <Legend className="bg-emerald-500" label="Receita" />
            <Legend className="bg-rose-500" label="Despesa" />
            <Legend className="bg-sky-500" label="Margem" />
          </div>
        </div>
        {hasData ? (
          <div className="h-44 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={chartData} margin={{ top: 4, right: 4, left: 4, bottom: 0 }}>
                <XAxis dataKey="month" tick={{ fontSize: 10 }} axisLine={false} tickLine={false} />
                <Tooltip
                  formatter={((v: unknown) => brlFromCents(Number(v) * 100)) as never}
                  contentStyle={{ borderRadius: 8, fontSize: 12 }}
                />
                <Bar dataKey="receita" fill="#10b981" radius={[3, 3, 0, 0]} barSize={8} />
                <Bar dataKey="despesa" fill="#f43f5e" radius={[3, 3, 0, 0]} barSize={8} />
                <Line dataKey="margem" stroke="#0ea5e9" strokeWidth={2} dot={false} type="monotone" />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        ) : (
          <div className="flex h-44 items-center justify-center text-sm text-muted-foreground">
            {loading ? "carregando…" : "sem lançamentos no período"}
          </div>
        )}
      </div>

      {/* ─── Categorias (clicar → drill; lista completa, mesmo zeradas) ── */}
      <div>
        <p className="px-1 pb-2 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
          Categorias · {categories.length}
        </p>
        {categories.length > 0 ? (
          <AppFileList>
            {categories
              .filter((c) => !c.archived)
              .map((cat) => {
                const amountCents =
                  data?.categories.find((t) => t.categoryId === cat.id)?.amountCents ?? 0;
                const total: CategoryTotal = {
                  categoryId: cat.id,
                  slug: cat.slug,
                  kind: cat.kind,
                  name: cat.name,
                  amountCents,
                };
                return (
                  <AppFileRow
                    key={cat.id}
                    icon={cat.kind === "revenue" ? Banknote : Receipt}
                    tileClassName={
                      cat.kind === "revenue"
                        ? "bg-emerald-500/15 text-emerald-500"
                        : "bg-muted text-muted-foreground"
                    }
                    title={cat.name}
                    subtitle={cat.feeds_labor ? "salários · por membro" : cat.kind === "revenue" ? "receita" : "despesa"}
                    meta={brlFromCents(amountCents)}
                    onOpen={() => setDrill(total)}
                  />
                );
              })}
          </AppFileList>
        ) : (
          <div className="rounded-md border px-3 py-6 text-center text-sm text-muted-foreground">
            {loading ? "carregando…" : "categorias indisponíveis"}
          </div>
        )}
      </div>

      {/* ─── Custo de equipe: alocado vs overhead ────────────────────── */}
      {data && data.teamCost.compCents > 0 && (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-md border border-border/60 px-3 py-2 font-mono text-[11px] text-muted-foreground">
          <span className="inline-flex items-center gap-1.5 not-italic">
            <Users className="size-3" aria-hidden /> equipe
          </span>
          <span className="tabular-nums">
            comp <span className="text-foreground">{brlFromCents(data.teamCost.compCents)}</span>
          </span>
          <span className="tabular-nums">
            alocado <span className="text-foreground">{brlFromCents(data.teamCost.allocatedCents)}</span>
          </span>
          <span className="tabular-nums">
            overhead{" "}
            <span className="text-amber-600 dark:text-amber-400">
              {brlFromCents(data.teamCost.overheadCents)}
            </span>{" "}
            ({pct(data.teamCost.compCents > 0 ? data.teamCost.overheadCents / data.teamCost.compCents : null)})
          </span>
        </div>
      )}

      {/* ─── Margem por projeto ──────────────────────────────────────── */}
      <div>
        <p className="px-1 pb-2 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
          Margem por projeto · {data?.projects.length ?? 0}
        </p>
        {data && data.projects.length > 0 ? (
          <AppFileList>
            {data.projects.map((p) => {
              const directPct = p.revenueCents > 0 ? p.marginDirectCents / p.revenueCents : null;
              const teamPct = p.revenueCents > 0 ? p.marginTeamCents / p.revenueCents : null;
              const positive = p.marginTeamCents >= 0;
              return (
                <AppFileRow
                  key={p.projectId}
                  icon={TrendingUp}
                  tileClassName={
                    positive ? "bg-emerald-500/15 text-emerald-500" : "bg-rose-500/15 text-rose-500"
                  }
                  title={p.name}
                  subtitle={`${p.engagementType === "fixed_scope" ? "encomenda" : "squad"} · ${p.sprintCount} ${p.sprintCount === 1 ? "sprint" : "sprints"} · ${brlFromCents(p.revenueCents)} receita · ${brlFromCents(p.laborCents)} equipe`}
                  badge={
                    <span className="flex shrink-0 items-center gap-1">
                      <AppFileBadge tone="muted">direta {pct(directPct)}</AppFileBadge>
                      <AppFileBadge tone={positive ? "green" : "muted"}>equipe {pct(teamPct)}</AppFileBadge>
                    </span>
                  }
                  meta={brlFromCents(p.marginTeamCents)}
                  onOpen={() => openProject({ id: p.projectId, name: p.name })}
                />
              );
            })}
          </AppFileList>
        ) : (
          <div className="rounded-md border px-3 py-6 text-center text-sm text-muted-foreground">
            {loading ? "carregando…" : "sem dados financeiros por projeto ainda"}
          </div>
        )}
      </div>

      {/* ─── Aviso ───────────────────────────────────────────────────── */}
      {data && !data.ready && (
        <p className="rounded-md border border-dashed px-3 py-2 font-mono text-[11px] text-muted-foreground">
          sem dados: o schema <span className="text-foreground">finance</span> precisa estar exposto ao
          PostgREST (Dashboard → API → Exposed schemas) e você precisa ser admin.
        </p>
      )}

      {/* ─── Drill + form de criação ─────────────────────────────────── */}
      {drill && (
        <FinanceCategorySheet
          key={drill.categoryId}
          open
          onOpenChange={(o) => {
            if (!o) setDrill(null);
          }}
          category={drill}
          categories={categories}
          projects={projects}
          members={members}
          onChanged={reload}
        />
      )}
      {appForm && (
        <FinanceEntryForm
          key={appForm.key}
          open
          onOpenChange={(o) => {
            if (!o) setAppForm(null);
          }}
          kind={appForm.kind}
          categories={categories}
          projects={projects}
          members={members}
          onSaved={reload}
        />
      )}
      {assumptionsOpen && (
        <FinanceAssumptionsForm
          open
          onOpenChange={(o) => {
            if (!o) setAssumptionsOpen(false);
          }}
          projectId={null}
          scopeLabel="Premissas globais"
          onSaved={reload}
        />
      )}
    </div>
  );
}

const toneClass: Record<"income" | "expense" | "muted", string> = {
  income: "text-emerald-600 dark:text-emerald-400",
  expense: "text-rose-600 dark:text-rose-400",
  muted: "text-foreground",
};

function Kpi({
  label,
  icon: Icon,
  value,
  sub,
  tone,
}: {
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  value: string;
  sub?: string;
  tone: "income" | "expense" | "muted";
}) {
  return (
    <div className="rounded-md border p-3">
      <div className="flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
        <Icon className="size-3" />
        {label}
      </div>
      <p className={cn("mt-1.5 text-lg font-bold tabular-nums tracking-tight", toneClass[tone])}>
        {value}
      </p>
      {sub && <p className="mt-0.5 text-[11px] text-muted-foreground">{sub}</p>}
    </div>
  );
}

function Legend({ className, label }: { className: string; label: string }) {
  return (
    <span className="flex items-center gap-1">
      <span className={cn("size-2 rounded-full", className)} />
      {label}
    </span>
  );
}
