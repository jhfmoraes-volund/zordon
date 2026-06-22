"use client";

/**
 * Drill de projeto — análise financeira do projeto + editor de alocação de
 * equipe (finance.labor_allocation). KPIs (margem direta × equipe), série
 * mensal, custo de equipe por membro, e CRUD de alocação (% por membro com
 * vigência; squad do projeto vem primeiro). Remontado por projeto via `key`.
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
import { Pencil, Plus, SlidersHorizontal, Trash2, Users } from "lucide-react";

import {
  ResponsiveSheet,
  ResponsiveSheetBody,
  ResponsiveSheetContent,
  ResponsiveSheetHeader,
  ResponsiveSheetTitle,
} from "@/components/ui/responsive-sheet";
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
import { fetchOrThrow, showErrorToast } from "@/lib/optimistic/toast";
import { brlFromCents, pct } from "@/lib/format-currency";
import { fmtDate } from "@/lib/date-utils";
import { cn } from "@/lib/utils";
import { positionLabel } from "@/lib/roles";
import type { AllocationItem, MemberRef, ProjectDetail } from "@/lib/finance/types";
import { FinanceAssumptionsForm } from "./finance-assumptions-form";

function monthLabel(iso: string): string {
  return new Date(iso)
    .toLocaleDateString("pt-BR", { month: "short", timeZone: "UTC" })
    .replace(".", "");
}
function firstOfMonthISO(): string {
  return `${new Date().toISOString().slice(0, 7)}-01`;
}

type FormState = { id: string | null; memberId: string; percent: string; from: string; to: string };

export function FinanceProjectSheet({
  open,
  onOpenChange,
  projectId,
  projectName,
  year,
  members,
  onChanged,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  projectId: string;
  projectName: string;
  year: number;
  members: MemberRef[];
  onChanged: () => void;
}) {
  const [detail, setDetail] = useState<ProjectDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [confirm, setConfirm] = useState<ConfirmState | null>(null);
  const [form, setForm] = useState<FormState | null>(null);
  const [saving, setSaving] = useState(false);
  const [assumptionsOpen, setAssumptionsOpen] = useState(false);

  const reload = useCallback(async () => {
    const res = await fetch(`/api/finance/projects/${projectId}?from=${year}-01&to=${year}-12`);
    const json = res.ok ? ((await res.json()) as ProjectDetail) : null;
    setDetail(json);
  }, [projectId, year]);

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

  const chartData = (detail?.months ?? []).map((m) => ({
    month: monthLabel(m.month),
    receita: m.revenue_cents / 100,
    despesa: m.expense_cents / 100,
    equipe: m.labor_cents / 100,
    margem: m.margin_team_cents / 100,
  }));

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

  return (
    <ResponsiveSheet open={open} onOpenChange={onOpenChange}>
      <ResponsiveSheetContent size="lg">
        <ResponsiveSheetHeader>
          <ResponsiveSheetTitle>{detail?.name ?? projectName}</ResponsiveSheetTitle>
        </ResponsiveSheetHeader>

        <ResponsiveSheetBody>
          {loading || !detail ? (
            <p className="px-1 py-10 text-center text-sm text-muted-foreground">
              {loading ? "carregando…" : "sem dados"}
            </p>
          ) : (
            <div className="space-y-4">
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

              {/* DRE — folha de cálculo da margem (padrão planilha P&L) */}
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

              {/* Série mensal */}
              {chartData.length > 0 && (
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
              )}

              {/* Alocação de equipe */}
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
            </div>
          )}
        </ResponsiveSheetBody>
      </ResponsiveSheetContent>

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
    </ResponsiveSheet>
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
