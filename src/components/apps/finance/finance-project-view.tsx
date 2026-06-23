"use client";

/**
 * Hub financeiro do projeto — renderiza DENTRO da janela do canvas de Apps
 * (não é mais um modal). Regra firmada (RB2): canvas = ler/navegar/dashboard ·
 * bottom-sheet = escrever focado. Layout V2 Dashboard: 2 colunas no desktop
 * (esq Contratos→Equipe→Cronograma · dir KPIs→NF→DRE→Cláusulas), gráfico
 * full-width no fundo; mobile colapsa pro stack (col direita antes da esquerda).
 * Escopo segmentado (Global · contratos · +) re-escopa tudo pela vigência.
 * Remontado por projeto via `key` no `FinanceApp`.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Bar,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
} from "recharts";
import {
  CalendarRange,
  ChevronLeft,
  Paperclip,
  Pencil,
  Plus,
  Scale,
  Shield,
  SlidersHorizontal,
  Trash2,
  Users,
} from "lucide-react";

import { Field, FormBody } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { ConfirmDialog, type ConfirmState } from "@/components/ui/confirm-dialog";
import { Cronograma } from "@/components/timeline/cronograma";
import { useIsMobile } from "@/hooks/use-mobile";
import { fetchOrThrow, showErrorToast } from "@/lib/optimistic/toast";
import { brlFromCents, pct } from "@/lib/format-currency";
import { fmtDate, fmtDayMonth } from "@/lib/date-utils";
import { cn } from "@/lib/utils";
import { positionLabel } from "@/lib/roles";
import type { AllocationItem, MemberRef, ProjectDetail } from "@/lib/finance/types";
import { FinanceAssumptionsForm } from "./finance-assumptions-form";
import { FinanceFpBilling } from "./finance-fp-billing";
import { FinanceContracts, type FinanceContractsHandle } from "./finance-contracts";
import { contractForDate, paletteFor } from "./contract-bands";

function monthLabel(iso: string): string {
  return new Date(iso)
    .toLocaleDateString("pt-BR", { month: "short", timeZone: "UTC" })
    .replace(".", "");
}
function firstOfMonthISO(): string {
  return `${new Date().toISOString().slice(0, 7)}-01`;
}
/** "Sprint 12" → "12"; resto inalterado. Rótulo curto pro chip do cronograma. */
function shortName(name: string): string {
  const m = /^Sprint\s+(.+)$/i.exec(name);
  return m ? m[1] : name;
}

type FormState = { id: string | null; memberId: string; percent: string; from: string; to: string };

export function FinanceProjectView({
  projectId,
  projectName,
  year,
  members,
  onChanged,
  onBack,
}: {
  projectId: string;
  projectName: string;
  year: number;
  members: MemberRef[];
  onChanged: () => void;
  onBack: () => void;
}) {
  const isMobile = useIsMobile();
  const [detail, setDetail] = useState<ProjectDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [confirm, setConfirm] = useState<ConfirmState | null>(null);
  const [form, setForm] = useState<FormState | null>(null);
  const [saving, setSaving] = useState(false);
  const [assumptionsOpen, setAssumptionsOpen] = useState(false);
  // Escopo: null = ano inteiro (Global); senão a vigência de um contrato.
  const [scope, setScope] = useState<{ id: string | null; from: string; to: string }>({
    id: null,
    from: `${year}-01`,
    to: `${year}-12`,
  });
  // Abre a criação de contrato (form inline do FinanceContracts) a partir do `+`
  // do segmentado. Vira o sheet rico na Fase 2.6.
  const contractsRef = useRef<FinanceContractsHandle>(null);

  const reload = useCallback(async () => {
    const res = await fetch(`/api/finance/projects/${projectId}?from=${scope.from}&to=${scope.to}`);
    const json = res.ok ? ((await res.json()) as ProjectDetail) : null;
    setDetail(json);
  }, [projectId, scope.from, scope.to]);

  // Escopa a uma vigência de contrato ou volta pro ano (Global).
  const selectScope = useCallback(
    (contractId: string | null) => {
      if (!contractId) {
        setScope({ id: null, from: `${year}-01`, to: `${year}-12` });
        return;
      }
      const c = detail?.contracts.find((x) => x.id === contractId);
      if (!c) return;
      setScope({
        id: contractId,
        from: c.effectiveFrom.slice(0, 7),
        to: (c.effectiveTo ?? `${year}-12-31`).slice(0, 7),
      });
    },
    [detail?.contracts, year],
  );

  useEffect(() => {
    let cancelled = false;
    (async () => {
      await reload();
      if (!cancelled) setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [reload]);

  // Membros internos ordenados: squad do projeto primeiro.
  const memberOptions = useMemo(() => {
    const squad = new Set(detail?.squadMemberIds ?? []);
    return members
      .filter((m) => !m.isExternal)
      .sort((a, b) => {
        const sa = squad.has(a.id) ? 0 : 1;
        const sb = squad.has(b.id) ? 0 : 1;
        return sa - sb || a.name.localeCompare(b.name);
      });
  }, [members, detail?.squadMemberIds]);

  const laborMap = useMemo(
    () => new Map((detail?.laborByMember ?? []).map((l) => [l.memberId, l.laborCents])),
    [detail?.laborByMember],
  );

  function openAdd() {
    setForm({ id: null, memberId: "", percent: "", from: firstOfMonthISO(), to: "" });
  }
  function openEdit(a: AllocationItem) {
    setForm({
      id: a.id,
      memberId: a.member_id,
      percent: String(a.percent),
      from: a.effective_from,
      to: a.effective_to ?? "",
    });
  }

  async function saveForm() {
    if (!form) return;
    const percent = parseFloat(form.percent.replace(",", "."));
    if (!form.memberId || !(percent > 0 && percent <= 100) || !form.from) return;
    setSaving(true);
    try {
      await fetchOrThrow(
        form.id ? `/api/finance/allocations/${form.id}` : "/api/finance/allocations",
        {
          method: form.id ? "PATCH" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            memberId: form.memberId,
            projectId,
            percent,
            effectiveFrom: form.from,
            effectiveTo: form.to || null,
          }),
        },
      );
      setForm(null);
      await reload();
      onChanged();
    } catch (e) {
      showErrorToast(e, { label: "Falha ao salvar alocação" });
    } finally {
      setSaving(false);
    }
  }

  function removeAllocation(a: AllocationItem) {
    setConfirm({
      title: "Remover alocação?",
      description: `${a.memberName} deixará de compor o custo de equipe deste projeto.`,
      destructive: true,
      confirmLabel: "Remover",
      onConfirm: async () => {
        try {
          await fetchOrThrow(`/api/finance/allocations/${a.id}`, { method: "DELETE" });
          await reload();
          onChanged();
        } catch (e) {
          showErrorToast(e, { label: "Falha ao remover alocação" });
        }
      },
    });
  }

  // Cabeçalho: voltar + identidade do projeto (sempre visível).
  const header = (
    <div className="flex items-center gap-2">
      <button
        type="button"
        onClick={onBack}
        className="inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
      >
        <ChevronLeft className="size-3.5" /> Projetos
      </button>
      <div className="min-w-0">
        <p className="truncate text-base font-semibold leading-tight">{detail?.name ?? projectName}</p>
        {detail && (
          <p className="font-mono text-[11px] text-muted-foreground">
            {detail.sprintCount} {detail.sprintCount === 1 ? "sprint" : "sprints"} · {year}
          </p>
        )}
      </div>
    </div>
  );

  if (loading || !detail) {
    return (
      <div className="space-y-4">
        {header}
        <p className="px-1 py-10 text-center text-sm text-muted-foreground">
          {loading ? "carregando…" : "sem dados"}
        </p>
      </div>
    );
  }

  // ── A partir daqui `detail` é não-nulo. Blocos compostos no layout V2. ──
  const selectedContract = scope.id
    ? (detail.contracts.find((c) => c.id === scope.id) ?? null)
    : null;
  const profitTone =
    detail.dre.lucroLiquidoCents >= 0
      ? "text-emerald-600 dark:text-emerald-400"
      : "text-rose-600 dark:text-rose-400";

  const chartData = detail.months.map((m) => ({
    month: monthLabel(m.month),
    receita: m.revenue_cents / 100,
    despesa: m.expense_cents / 100,
    equipe: m.labor_cents / 100,
    margem: m.margin_team_cents / 100,
  }));

  // KPIs scope-aware: 4º card varia (Contratos · FP entregue · Mensalidade).
  const kpis: { label: string; value: string; tone?: string }[] = [
    { label: "Faturamento", value: brlFromCents(detail.dre.faturamentoCents) },
    { label: "Margem líq.", value: pct(detail.dre.margemLiquidaPct), tone: profitTone },
    { label: "Lucro líquido", value: brlFromCents(detail.dre.lucroLiquidoCents), tone: profitTone },
    selectedContract
      ? selectedContract.billingType === "fixed_scope"
        ? {
            label: "FP entregue",
            value: `${detail.fpDeliveredTotal}${selectedContract.contractedFp != null ? `/${selectedContract.contractedFp}` : ""}`,
          }
        : {
            label: "Mensalidade",
            value:
              selectedContract.monthlyFeeCents != null
                ? brlFromCents(selectedContract.monthlyFeeCents)
                : "—",
          }
      : { label: "Contratos", value: String(detail.contracts.length) },
  ];

  const kpisBlock = (
    <div className="grid grid-cols-2 gap-2">
      {kpis.map((k) => (
        <div key={k.label} className="rounded-md border p-3">
          <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
            {k.label}
          </p>
          <p className={cn("mt-1.5 font-mono text-base font-semibold tabular-nums", k.tone)}>
            {k.value}
          </p>
        </div>
      ))}
    </div>
  );

  const dreBlock = (
    <div className="surface overflow-hidden rounded-md border">
      <DreLine label="Faturamento" cents={detail.dre.faturamentoCents} strong />
      <DreLine label="(−) Impostos (ISS/PIS/COFINS)" cents={-detail.dre.impostosCents} deduction />
      <DreLine label="= Receita líquida" cents={detail.dre.receitaLiquidaCents} subtotal />
      <DreLine label="(−) Equipe" cents={-detail.dre.laborCents} deduction />
      <DreLine label="(−) Overhead por pessoa" cents={-detail.dre.overheadCents} deduction />
      <DreLine label="(−) Despesa direta" cents={-detail.dre.directExpenseCents} deduction />
      <DreLine label="(−) Custo financeiro" cents={-detail.dre.custoFinanceiroCents} deduction />
      <DreLine label="= Margem bruta" cents={detail.dre.margemBrutaCents} subtotal />
      <DreLine label="(−) SG&A" cents={-detail.dre.sgaCents} deduction />
      <DreLine label="= LAIR" cents={detail.dre.lairCents} subtotal />
      <DreLine label="(−) IRPJ/CSLL" cents={-detail.dre.irpjCsllCents} deduction />
      <DreLine
        label="= Lucro líquido"
        cents={detail.dre.lucroLiquidoCents}
        strong
        sub={`${pct(detail.dre.margemLiquidaPct)} da receita`}
      />
    </div>
  );

  // Cláusulas & Garantia — read, scope-aware (lê contract_clause via getProjectDetail).
  const scopedClauses = scope.id ? detail.clauses.filter((cl) => cl.contractId === scope.id) : [];
  const clausesEmpty =
    !!selectedContract &&
    !selectedContract.warranty &&
    scopedClauses.length === 0 &&
    !selectedContract.proposalRef;
  const clausesBlock = (
    <div>
      <p className="mb-2 flex items-center gap-1.5 px-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
        <Scale className="size-3.5" /> Cláusulas &amp; Garantia
      </p>
      <div className="rounded-md border p-3">
        {!selectedContract ? (
          <p className="text-xs italic text-muted-foreground">
            Selecione um contrato pra ver garantia e cláusulas.
          </p>
        ) : clausesEmpty ? (
          <p className="text-xs italic text-muted-foreground">
            Nenhuma cláusula ou garantia ainda — edite o contrato pra adicionar.
          </p>
        ) : (
          <div className="space-y-2.5 text-sm">
            {selectedContract.warranty && (
              <div className="flex items-center gap-2 text-[13px]">
                <Shield className="size-3.5 shrink-0 text-muted-foreground" />
                <span>
                  <span className="text-muted-foreground">Garantia:</span> {selectedContract.warranty}
                </span>
              </div>
            )}
            {scopedClauses.length > 0 && (
              <ul className="space-y-1.5">
                {scopedClauses.map((cl) => (
                  <li key={cl.id} className="flex gap-2 text-[12.5px]">
                    <span className="font-mono text-muted-foreground">§</span>
                    <span>{cl.text}</span>
                  </li>
                ))}
              </ul>
            )}
            {selectedContract.proposalRef && (
              <div className="flex items-center gap-1.5 pt-0.5 text-[11.5px] text-sky-600 dark:text-sky-400">
                <Paperclip className="size-3 shrink-0" /> {selectedContract.proposalRef}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );

  // Cronograma — grade 3-por-linha (desktop) / faixa que rola (mobile), via prop
  // genérica do componente unificado. Escopado: contrato → só suas sprints.
  const cronoSprints = scope.id
    ? detail.sprints.filter((s) => contractForDate(detail.contracts, s.startDate)?.id === scope.id)
    : detail.sprints;
  const cronoBlock = cronoSprints.length > 0 && (
    <div>
      <p className="mb-2 flex items-center gap-1.5 px-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
        <CalendarRange className="size-3.5" /> Cronograma
      </p>
      <div className="rounded-md border p-3">
        <Cronograma
          shape="chip"
          layout={isMobile ? "scroll" : "grid"}
          gridCols={3}
          blocks={cronoSprints.map((s) => {
            const c = contractForDate(detail.contracts, s.startDate);
            const pal = c ? paletteFor(c.seq) : null;
            return {
              key: s.id,
              indicator: shortName(s.name),
              dateLabel: fmtDayMonth(s.startDate),
              tone: pal ? { border: pal.border, band: pal.band, text: pal.text } : undefined,
              title: `${s.name} · ${fmtDate(s.startDate)} → ${fmtDate(s.endDate)}`,
            };
          })}
        />
      </div>
    </div>
  );

  const contractsBlock = (
    <FinanceContracts
      ref={contractsRef}
      projectId={projectId}
      contracts={detail.contracts}
      sprints={detail.sprints}
      engagementType={detail.engagementType}
      selectedContractId={scope.id}
      onSelectContract={selectScope}
      onChanged={() => {
        void reload();
        onChanged();
      }}
    />
  );

  const fpBlock = (detail.engagementType === "fixed_scope" ||
    detail.contracts.some((c) => c.billingType === "fixed_scope")) && (
    <FinanceFpBilling
      projectId={projectId}
      contracts={detail.contracts}
      onChanged={() => {
        void reload();
        onChanged();
      }}
    />
  );

  const teamBlock = (
    <div>
      <div className="mb-2 flex items-center justify-between px-1">
        <p className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
          <Users className="size-3.5" /> Equipe alocada
        </p>
        {!form && (
          <Button size="sm" variant="outline" onClick={openAdd}>
            <Plus className="size-3.5" /> Alocar
          </Button>
        )}
      </div>

      {form && (
        <div className="mb-2 rounded-md border bg-muted/20 p-3">
          <FormBody density="compact">
            <Field.Row cols={2}>
              <Field name="member" required>
                <Field.Label>Membro</Field.Label>
                <Field.Control>
                  <Select
                    value={form.memberId}
                    onValueChange={(v) => setForm((f) => (f ? { ...f, memberId: v ?? "" } : f))}
                  >
                    <SelectTrigger>
                      <SelectValue>
                        {(v: string | null) =>
                          memberOptions.find((m) => m.id === v)?.name ?? "Selecione…"
                        }
                      </SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      {memberOptions.map((m) => (
                        <SelectItem key={m.id} value={m.id}>
                          {m.name}
                          {m.position ? ` · ${positionLabel(m.position)}` : ""}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field.Control>
              </Field>
              <Field name="percent" required>
                <Field.Label>Alocação (%)</Field.Label>
                <Field.Control>
                  <Input
                    type="number"
                    min="0"
                    max="100"
                    step="1"
                    value={form.percent}
                    onChange={(e) => setForm((f) => (f ? { ...f, percent: e.target.value } : f))}
                    placeholder="ex: 50"
                  />
                </Field.Control>
              </Field>
            </Field.Row>
            <Field.Row cols={2}>
              <Field name="from" required>
                <Field.Label>Início</Field.Label>
                <Field.Control>
                  <Input
                    type="date"
                    value={form.from}
                    onChange={(e) => setForm((f) => (f ? { ...f, from: e.target.value } : f))}
                  />
                </Field.Control>
              </Field>
              <Field name="to">
                <Field.Label>Fim (opcional)</Field.Label>
                <Field.Control>
                  <Input
                    type="date"
                    value={form.to}
                    onChange={(e) => setForm((f) => (f ? { ...f, to: e.target.value } : f))}
                  />
                </Field.Control>
              </Field>
            </Field.Row>
          </FormBody>
          <div className="mt-2 flex justify-end gap-2">
            <Button size="sm" variant="ghost" onClick={() => setForm(null)} disabled={saving}>
              Cancelar
            </Button>
            <Button size="sm" onClick={saveForm} disabled={saving}>
              {saving ? "Salvando…" : "Salvar"}
            </Button>
          </div>
        </div>
      )}

      {detail.allocations.length === 0 ? (
        <div className="rounded-md border px-3 py-6 text-center text-sm text-muted-foreground">
          Ninguém alocado — a margem equipe ainda não desconta mão-de-obra.
        </div>
      ) : (
        <div className="surface divide-y divide-border/60 overflow-hidden">
          {detail.allocations.map((a) => (
            <div key={a.id} className="group flex items-center gap-3 px-3 py-2.5">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{a.memberName}</p>
                <p className="truncate text-xs text-muted-foreground">
                  {a.percent}% · {fmtDate(a.effective_from)} →{" "}
                  {a.effective_to ? fmtDate(a.effective_to) : "atual"}
                </p>
              </div>
              <span className="shrink-0 font-mono text-xs text-muted-foreground tabular-nums">
                {brlFromCents(laborMap.get(a.member_id) ?? 0)}
              </span>
              <div className="flex shrink-0 items-center gap-1">
                <button
                  type="button"
                  title="Editar"
                  aria-label="Editar"
                  onClick={() => openEdit(a)}
                  className="rounded-sm p-1 text-muted-foreground opacity-0 transition-opacity hover:bg-muted hover:text-foreground group-hover:opacity-100"
                >
                  <Pencil className="size-3.5" />
                </button>
                <button
                  type="button"
                  title="Remover"
                  aria-label="Remover"
                  onClick={() => removeAllocation(a)}
                  className="rounded-sm p-1 text-muted-foreground opacity-0 transition-opacity hover:bg-muted hover:text-rose-500 group-hover:opacity-100"
                >
                  <Trash2 className="size-3.5" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );

  const chartBlock = chartData.length > 0 && (
    <div className="rounded-md border p-3">
      <div className="mb-2 flex items-center gap-3 px-1 text-[10px] text-muted-foreground">
        <Legend className="bg-emerald-500" label="Receita" />
        <Legend className="bg-rose-500" label="Despesa" />
        <Legend className="bg-amber-500" label="Equipe" />
        <Legend className="bg-sky-500" label="Margem" />
      </div>
      <div className="h-36 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={chartData} margin={{ top: 4, right: 4, left: 4, bottom: 0 }}>
            <XAxis dataKey="month" tick={{ fontSize: 10 }} axisLine={false} tickLine={false} />
            <Tooltip
              formatter={((v: unknown) => brlFromCents(Number(v) * 100)) as never}
              contentStyle={{ borderRadius: 8, fontSize: 12 }}
            />
            <Bar dataKey="receita" fill="#10b981" radius={[3, 3, 0, 0]} barSize={7} />
            <Bar dataKey="despesa" fill="#f43f5e" radius={[3, 3, 0, 0]} barSize={7} />
            <Bar dataKey="equipe" fill="#f59e0b" radius={[3, 3, 0, 0]} barSize={7} />
            <Line dataKey="margem" stroke="#0ea5e9" strokeWidth={2} dot={false} type="monotone" />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </div>
  );

  return (
    <div className="space-y-4">
      {header}

      {/* Premissas em uso */}
      <div className="flex items-center justify-between gap-2 rounded-md border border-border/60 px-3 py-1.5 font-mono text-[11px] text-muted-foreground">
        <span>
          premissas:{" "}
          <span className="text-foreground">
            {detail.assumptionsIsOverride ? "próprias do projeto" : "globais"}
          </span>
        </span>
        <button
          type="button"
          onClick={() => setAssumptionsOpen(true)}
          className="inline-flex items-center gap-1 rounded-sm px-1.5 py-0.5 hover:bg-muted hover:text-foreground"
        >
          <SlidersHorizontal className="size-3" /> ajustar
        </button>
      </div>

      {/* Escopo segmentado: Global · <contratos> · + — re-escopa TUDO (KPIs, DRE,
          equipe, cronograma, NF) pela vigência. `+` cria contrato. */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex min-w-0 items-center gap-1 overflow-x-auto rounded-lg border bg-muted/30 p-1 no-scrollbar">
          <button
            type="button"
            onClick={() => selectScope(null)}
            className={cn(
              "flex shrink-0 items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors",
              scope.id === null
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            <span
              aria-hidden
              className="size-1.5 rounded-full bg-gradient-to-br from-sky-500 to-violet-500"
            />
            Global
          </button>
          {detail.contracts.map((c) => {
            const pal = paletteFor(c.seq);
            const active = scope.id === c.id;
            return (
              <button
                key={c.id}
                type="button"
                onClick={() => selectScope(c.id)}
                className={cn(
                  "flex shrink-0 items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors",
                  active
                    ? "bg-background text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                <span aria-hidden className={cn("size-1.5 rounded-full", pal.dot)} />
                {c.label}
              </button>
            );
          })}
          <button
            type="button"
            title="Novo contrato"
            aria-label="Novo contrato"
            onClick={() => contractsRef.current?.openCreate()}
            className="flex shrink-0 items-center rounded-md border border-dashed px-2 py-1.5 text-muted-foreground transition-colors hover:border-foreground/40 hover:text-foreground"
          >
            <Plus className="size-3.5" />
          </button>
        </div>
        <span className="font-mono text-[11px] text-muted-foreground">
          {selectedContract
            ? `${fmtDate(selectedContract.effectiveFrom)} → ${selectedContract.effectiveTo ? fmtDate(selectedContract.effectiveTo) : "atual"}`
            : `ano ${year}`}
        </span>
      </div>

      {/* V2 Dashboard: esq estrutura (Contratos→FP→Equipe→Cronograma) · dir
          análise (KPIs→NF→DRE→Cláusulas). Mobile: 1 coluna, análise primeiro. */}
      <div className="grid gap-4 lg:grid-cols-[minmax(0,340px)_minmax(0,1fr)]">
        <div className="order-2 space-y-4 lg:order-1">
          {contractsBlock}
          {fpBlock}
          {teamBlock}
          {cronoBlock}
        </div>
        <div className="order-1 space-y-4 lg:order-2">
          {kpisBlock}
          {/* Widget Notas Fiscais — Fase 2.5 */}
          {dreBlock}
          {clausesBlock}
        </div>
      </div>

      {/* Gráfico mensal — full-width no fundo */}
      {chartBlock}

      <ConfirmDialog state={confirm} onClose={() => setConfirm(null)} />

      {assumptionsOpen && (
        <FinanceAssumptionsForm
          open
          onOpenChange={(o) => {
            if (!o) setAssumptionsOpen(false);
          }}
          projectId={projectId}
          scopeLabel="Premissas do projeto"
          onSaved={() => {
            void reload();
            onChanged();
          }}
        />
      )}
    </div>
  );
}

function DreLine({
  label,
  cents,
  strong,
  subtotal,
  deduction,
  sub,
}: {
  label: string;
  cents: number;
  strong?: boolean;
  subtotal?: boolean;
  deduction?: boolean;
  sub?: string;
}) {
  return (
    <div
      className={cn(
        "flex items-center justify-between gap-3 px-3 py-1.5 text-sm",
        (strong || subtotal) && "border-t bg-muted/20",
        strong && "font-semibold",
        subtotal && "font-medium",
      )}
    >
      <span className={cn(deduction && "text-muted-foreground")}>{label}</span>
      <span className="flex items-center gap-2">
        {sub && <span className="text-[11px] font-normal text-muted-foreground">{sub}</span>}
        <span
          className={cn(
            "font-mono tabular-nums",
            deduction || cents < 0 ? "text-rose-600 dark:text-rose-400" : "text-foreground",
          )}
        >
          {brlFromCents(cents)}
        </span>
      </span>
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
