"use client";

/**
 * Editor de contratos do projeto (vigência temporal). N contratos por projeto:
 * sprints diferentes podem rodar sob contratos diferentes (HITz: 1-3 sob A,
 * 4+ sob B). A fronteira é autorada por sprint (preenche a data pelo
 * startDate/endDate da sprint) mas guardada por data. Clicar num contrato
 * escopa a DRE àquela vigência. Visível pra squad e encomenda.
 *
 * Cada card embute seu próprio cronograma de blocos (as sprints cobertas pela
 * vigência, numa faixa horizontal que rola) — substitui o cronograma global,
 * tornando explícita a relação contrato→sprints.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { FileText, Pencil, Plus, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Field, FormBody } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ConfirmDialog, type ConfirmState } from "@/components/ui/confirm-dialog";
import { fetchOrThrow, showErrorToast } from "@/lib/optimistic/toast";
import { brlFromCents } from "@/lib/format-currency";
import { fmtDate } from "@/lib/date-utils";
import { cn } from "@/lib/utils";
import type {
  BillingType,
  Contract,
  ContractMonthOverride,
  ContractOverridesResponse,
  SprintLite,
} from "@/lib/finance/types";
import { contractForDate, paletteFor } from "./contract-bands";

function firstOfMonthISO(): string {
  return `${new Date().toISOString().slice(0, 7)}-01`;
}

type FormState = {
  id: string | null;
  label: string;
  billingType: BillingType;
  from: string;
  to: string;
  monthlyFeeReais: string;
  pricePerFpReais: string;
  contractedFp: string;
  contractedSprints: string;
  note: string;
};

function centsToReais(c: number | null): string {
  return c != null ? (c / 100).toString() : "";
}
function reaisToCents(s: string): number | null {
  const n = parseFloat(s.replace(",", "."));
  return Number.isFinite(n) ? Math.round(n * 100) : null;
}
function numOrNull(s: string): number | null {
  const n = parseFloat(s.replace(",", "."));
  return Number.isFinite(n) ? n : null;
}
function billingLabel(b: BillingType): string {
  return b === "fixed_scope" ? "Encomenda" : "Squad";
}
/** "Sprint 12" → "12"; resto inalterado. Rótulo curto pros blocos do cronograma. */
function shortName(name: string): string {
  const m = /^Sprint\s+(.+)$/i.exec(name);
  return m ? m[1] : name;
}

/** Sprints cobertas por este contrato (membership pela data de início da sprint). */
function coveredSprints(contract: Contract, contracts: Contract[], sprints: SprintLite[]): SprintLite[] {
  return sprints.filter((s) => contractForDate(contracts, s.startDate)?.id === contract.id);
}

export function FinanceContracts({
  projectId,
  contracts,
  sprints,
  engagementType,
  selectedContractId,
  onSelectContract,
  onChanged,
}: {
  projectId: string;
  contracts: Contract[];
  sprints: SprintLite[];
  engagementType: string | null;
  selectedContractId: string | null;
  onSelectContract: (id: string | null) => void;
  onChanged: () => void;
}) {
  const [form, setForm] = useState<FormState | null>(null);
  const [saving, setSaving] = useState(false);
  const [confirm, setConfirm] = useState<ConfirmState | null>(null);

  const defaultBilling: BillingType = engagementType === "fixed_scope" ? "fixed_scope" : "squad";

  function openAdd() {
    onSelectContract(null);
    setForm({
      id: null,
      label: `Contrato ${contracts.length + 1}`,
      billingType: defaultBilling,
      from: "",
      to: "",
      monthlyFeeReais: "",
      pricePerFpReais: "",
      contractedFp: "",
      contractedSprints: "",
      note: "",
    });
  }
  function openEdit(c: Contract) {
    setForm({
      id: c.id,
      label: c.label,
      billingType: c.billingType,
      from: c.effectiveFrom.slice(0, 10),
      to: c.effectiveTo?.slice(0, 10) ?? "",
      monthlyFeeReais: centsToReais(c.monthlyFeeCents),
      pricePerFpReais: centsToReais(c.pricePerFpCents),
      contractedFp: c.contractedFp != null ? String(c.contractedFp) : "",
      contractedSprints: c.contractedSprints != null ? String(c.contractedSprints) : "",
      note: c.note ?? "",
    });
  }

  async function save() {
    if (!form) return;
    if (!form.label.trim() || !form.from) return;
    const isFixed = form.billingType === "fixed_scope";
    const body = {
      label: form.label.trim(),
      effectiveFrom: form.from,
      effectiveTo: form.to || null,
      billingType: form.billingType,
      monthlyFeeCents: isFixed ? null : reaisToCents(form.monthlyFeeReais),
      pricePerFpCents: isFixed ? reaisToCents(form.pricePerFpReais) : null,
      contractedFp: isFixed ? numOrNull(form.contractedFp) : null,
      contractedSprints: isFixed ? null : numOrNull(form.contractedSprints),
      note: form.note.trim() || null,
    };
    setSaving(true);
    try {
      await fetchOrThrow(
        form.id ? `/api/finance/contract/${form.id}` : "/api/finance/contract",
        {
          method: form.id ? "PATCH" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(form.id ? body : { projectId, ...body }),
        },
      );
      setForm(null);
      onChanged();
    } catch (e) {
      showErrorToast(e, { label: "Falha ao salvar contrato" });
    } finally {
      setSaving(false);
    }
  }

  function remove(c: Contract) {
    setConfirm({
      title: "Remover contrato?",
      description: `"${c.label}" deixará de reger as sprints da sua vigência.`,
      destructive: true,
      confirmLabel: "Remover",
      onConfirm: async () => {
        try {
          await fetchOrThrow(`/api/finance/contract/${c.id}`, { method: "DELETE" });
          if (selectedContractId === c.id) onSelectContract(null);
          onChanged();
        } catch (e) {
          showErrorToast(e, { label: "Falha ao remover contrato" });
        }
      },
    });
  }

  return (
    <div>
      <div className="mb-2 flex items-center justify-between px-1">
        <p className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
          <FileText className="size-3.5" /> Contratos
        </p>
        {!form && (
          <Button size="sm" variant="outline" onClick={openAdd}>
            <Plus className="size-3.5" /> Contrato
          </Button>
        )}
      </div>

      {form && (
        <ContractForm
          form={form}
          setForm={setForm}
          sprints={sprints}
          saving={saving}
          onSave={save}
          onCancel={() => setForm(null)}
          onChanged={onChanged}
        />
      )}

      {contracts.length === 0 && !form ? (
        <div className="rounded-md border px-3 py-6 text-center text-sm text-muted-foreground">
          Sem contrato — defina um pra registrar preço/condições por período.
        </div>
      ) : (
        <div className="space-y-2">
          {contracts.map((c) => {
            const pal = paletteFor(c.seq);
            const covered = coveredSprints(c, contracts, sprints);
            const selected = selectedContractId === c.id;
            return (
              <div
                key={c.id}
                role="button"
                tabIndex={0}
                onClick={() => onSelectContract(selected ? null : c.id)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") onSelectContract(selected ? null : c.id);
                }}
                className={cn(
                  "group cursor-pointer overflow-hidden rounded-lg border text-left transition-colors",
                  selected ? cn(pal.border, pal.band) : "border-border hover:bg-muted/40",
                )}
              >
                {/* Cabeçalho: identidade + vigência/preço + ações */}
                <div className="flex items-start gap-3 px-3 pb-2 pt-2.5">
                  <span className={cn("mt-1 size-2.5 shrink-0 rounded-full", pal.dot)} />
                  <div className="min-w-0 flex-1">
                    <p className="flex items-center gap-2 truncate text-sm font-medium">
                      {c.label}
                      <span className={cn("rounded-sm border px-1 py-px text-[10px] font-normal", pal.border, pal.text)}>
                        {billingLabel(c.billingType)}
                      </span>
                    </p>
                    <p className="truncate text-xs text-muted-foreground">
                      {fmtDate(c.effectiveFrom)} → {c.effectiveTo ? fmtDate(c.effectiveTo) : "atual"}
                      {c.billingType === "fixed_scope"
                        ? c.pricePerFpCents != null
                          ? ` · ${brlFromCents(c.pricePerFpCents)}/FP${c.contractedFp != null ? ` · ${c.contractedFp} FP` : ""}`
                          : ""
                        : c.monthlyFeeCents != null
                          ? ` · ${brlFromCents(c.monthlyFeeCents)}/mês${c.contractedSprints != null ? ` · ${c.contractedSprints} sprints` : ""}`
                          : ""}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    <button
                      type="button"
                      title="Editar"
                      aria-label="Editar"
                      onClick={(e) => {
                        e.stopPropagation();
                        openEdit(c);
                      }}
                      className="rounded-sm p-1 text-muted-foreground opacity-0 transition-opacity hover:bg-muted hover:text-foreground group-hover:opacity-100"
                    >
                      <Pencil className="size-3.5" />
                    </button>
                    <button
                      type="button"
                      title="Remover"
                      aria-label="Remover"
                      onClick={(e) => {
                        e.stopPropagation();
                        remove(c);
                      }}
                      className="rounded-sm p-1 text-muted-foreground opacity-0 transition-opacity hover:bg-muted hover:text-rose-500 group-hover:opacity-100"
                    >
                      <Trash2 className="size-3.5" />
                    </button>
                  </div>
                </div>

                {/* Cronograma de blocos deste contrato — faixa de 1 linha, rola na horizontal */}
                {covered.length > 0 && (
                  <div className="px-3 pb-2.5">
                    <div className="flex gap-1.5 overflow-x-auto pb-0.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                      {covered.map((s) => (
                        <span
                          key={s.id}
                          title={`${s.name} · ${fmtDate(s.startDate)} → ${fmtDate(s.endDate)}`}
                          className={cn(
                            "flex size-6 shrink-0 items-center justify-center rounded-sm border font-mono text-[10px] font-medium tabular-nums",
                            pal.border,
                            pal.band,
                            pal.text,
                          )}
                        >
                          {shortName(s.name)}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      <ConfirmDialog state={confirm} onClose={() => setConfirm(null)} />
    </div>
  );
}

function ContractForm({
  form,
  setForm,
  sprints,
  saving,
  onSave,
  onCancel,
  onChanged,
}: {
  form: FormState;
  setForm: (f: FormState | null) => void;
  sprints: SprintLite[];
  saving: boolean;
  onSave: () => void;
  onCancel: () => void;
  onChanged: () => void;
}) {
  const isFixed = form.billingType === "fixed_scope";
  const set = (patch: Partial<FormState>) => setForm({ ...form, ...patch });

  // "preencher por sprint": escolher sprint preenche a data de início/fim.
  const fromSprintId = useMemo(
    () => sprints.find((s) => s.startDate.slice(0, 10) === form.from)?.id ?? "",
    [sprints, form.from],
  );
  const toSprintId = useMemo(
    () => sprints.find((s) => s.endDate.slice(0, 10) === form.to)?.id ?? "",
    [sprints, form.to],
  );

  return (
    <div className="mb-2 rounded-md border bg-muted/20 p-3">
      <FormBody density="compact">
        <Field.Row cols={2}>
          <Field name="label" required>
            <Field.Label>Rótulo</Field.Label>
            <Field.Control>
              <Input
                value={form.label}
                onChange={(e) => set({ label: e.target.value })}
                placeholder="ex: Piloto, Renovação 2026"
              />
            </Field.Control>
          </Field>
          <Field name="billing" required>
            <Field.Label>Tipo</Field.Label>
            <Field.Control>
              <Select value={form.billingType} onValueChange={(v) => set({ billingType: (v as BillingType) ?? "squad" })}>
                <SelectTrigger>
                  <SelectValue>{(v: string | null) => (v === "fixed_scope" ? "Encomenda" : "Squad")}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="squad">Squad</SelectItem>
                  <SelectItem value="fixed_scope">Encomenda</SelectItem>
                </SelectContent>
              </Select>
            </Field.Control>
          </Field>
        </Field.Row>

        <Field.Row cols={2}>
          <Field name="from" required>
            <Field.Label>Início da vigência</Field.Label>
            <Field.Control>
              <Input type="date" value={form.from} onChange={(e) => set({ from: e.target.value })} />
            </Field.Control>
          </Field>
          <Field name="to">
            <Field.Label>Fim (vazio = vigente)</Field.Label>
            <Field.Control>
              <Input type="date" value={form.to} onChange={(e) => set({ to: e.target.value })} />
            </Field.Control>
          </Field>
        </Field.Row>

        {sprints.length > 0 && (
          <Field.Row cols={2}>
            <Field name="fromSprint">
              <Field.Label>↳ preencher início pela sprint</Field.Label>
              <Field.Control>
                <Select
                  value={fromSprintId}
                  onValueChange={(v) => {
                    const s = sprints.find((x) => x.id === v);
                    if (s) set({ from: s.startDate.slice(0, 10) });
                  }}
                >
                  <SelectTrigger>
                    <SelectValue>
                      {(v: string | null) => sprints.find((s) => s.id === v)?.name ?? "—"}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {sprints.map((s) => (
                      <SelectItem key={s.id} value={s.id}>
                        {s.name} · {fmtDate(s.startDate)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field.Control>
            </Field>
            <Field name="toSprint">
              <Field.Label>↳ preencher fim pela sprint</Field.Label>
              <Field.Control>
                <Select
                  value={toSprintId}
                  onValueChange={(v) => {
                    const s = sprints.find((x) => x.id === v);
                    if (s) set({ to: s.endDate.slice(0, 10) });
                  }}
                >
                  <SelectTrigger>
                    <SelectValue>
                      {(v: string | null) => sprints.find((s) => s.id === v)?.name ?? "—"}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {sprints.map((s) => (
                      <SelectItem key={s.id} value={s.id}>
                        {s.name} · {fmtDate(s.endDate)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field.Control>
            </Field>
          </Field.Row>
        )}

        {isFixed ? (
          <Field.Row cols={2}>
            <Field name="price">
              <Field.Label>Preço por FP (R$)</Field.Label>
              <Field.Control>
                <Input
                  type="number"
                  min="0"
                  step="0.01"
                  value={form.pricePerFpReais}
                  onChange={(e) => set({ pricePerFpReais: e.target.value })}
                  placeholder="ex: 1200,00"
                />
              </Field.Control>
            </Field>
            <Field name="scopeFp">
              <Field.Label>Escopo contratado (FP)</Field.Label>
              <Field.Control>
                <Input
                  type="number"
                  min="0"
                  step="1"
                  value={form.contractedFp}
                  onChange={(e) => set({ contractedFp: e.target.value })}
                  placeholder="ex: 500"
                />
              </Field.Control>
            </Field>
          </Field.Row>
        ) : (
          <Field.Row cols={2}>
            <Field name="fee">
              <Field.Label>Mensalidade (R$)</Field.Label>
              <Field.Control>
                <Input
                  type="number"
                  min="0"
                  step="0.01"
                  value={form.monthlyFeeReais}
                  onChange={(e) => set({ monthlyFeeReais: e.target.value })}
                  placeholder="ex: 24000,00"
                />
              </Field.Control>
            </Field>
            <Field name="scopeSprints">
              <Field.Label>Sprints contratadas</Field.Label>
              <Field.Control>
                <Input
                  type="number"
                  min="0"
                  step="1"
                  value={form.contractedSprints}
                  onChange={(e) => set({ contractedSprints: e.target.value })}
                  placeholder="ex: 3"
                />
              </Field.Control>
            </Field>
          </Field.Row>
        )}

        <Field name="note">
          <Field.Label>Nota</Field.Label>
          <Field.Control>
            <Input value={form.note} onChange={(e) => set({ note: e.target.value })} placeholder="condições, observações…" />
          </Field.Control>
        </Field>
      </FormBody>

      <div className="mt-2 flex justify-end gap-2">
        <Button size="sm" variant="ghost" onClick={onCancel} disabled={saving}>
          Cancelar
        </Button>
        <Button size="sm" onClick={onSave} disabled={saving || !form.label.trim() || !form.from}>
          {saving ? "Salvando…" : "Salvar"}
        </Button>
      </div>

      {/* Overrides de mês — só squad e só com o contrato já salvo */}
      {form.id && !isFixed && (
        <div className="mt-3 border-t pt-3">
          <MonthOverrides contractId={form.id} onChanged={onChanged} />
        </div>
      )}
      {form.id == null && !isFixed && (
        <p className="mt-3 border-t pt-3 text-[11px] text-muted-foreground">
          Salve o contrato pra adicionar overrides de mês (valor especial de um mês).
        </p>
      )}
    </div>
  );
}

/** Overrides de valor por mês — substituem a mensalidade base só no mês indicado. */
function MonthOverrides({ contractId, onChanged }: { contractId: string; onChanged: () => void }) {
  const [overrides, setOverrides] = useState<ContractMonthOverride[] | null>(null);
  const [month, setMonth] = useState(firstOfMonthISO());
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  const refetch = useCallback(async () => {
    const res = await fetch(`/api/finance/contract-override?contractId=${contractId}`);
    const json = res.ok ? ((await res.json()) as ContractOverridesResponse) : null;
    setOverrides(json?.overrides ?? []);
  }, [contractId]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      await refetch();
      void cancelled;
    })();
    return () => {
      cancelled = true;
    };
  }, [refetch]);

  async function add() {
    const cents = Math.round(parseFloat(amount.replace(",", ".")) * 100);
    if (!(cents >= 0) || !month) return;
    setBusy(true);
    try {
      await fetchOrThrow("/api/finance/contract-override", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contractId, month, amountCents: cents, note: note.trim() || null }),
      });
      setAmount("");
      setNote("");
      await refetch();
      onChanged();
    } catch (e) {
      showErrorToast(e, { label: "Falha ao salvar override" });
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string) {
    try {
      await fetchOrThrow(`/api/finance/contract-override/${id}`, { method: "DELETE" });
      await refetch();
      onChanged();
    } catch (e) {
      showErrorToast(e, { label: "Falha ao remover override" });
    }
  }

  return (
    <div>
      <p className="mb-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
        Override por mês <span className="font-normal normal-case">(substitui a mensalidade no mês)</span>
      </p>

      {overrides && overrides.length > 0 && (
        <div className="mb-2 surface divide-y divide-border/60 overflow-hidden">
          {overrides.map((o) => (
            <div key={o.id} className="group flex items-center gap-3 px-3 py-2">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm">
                  {fmtDate(o.month)}
                  {o.note ? <span className="text-muted-foreground"> · {o.note}</span> : null}
                </p>
              </div>
              <span className="shrink-0 font-mono text-xs tabular-nums">{brlFromCents(o.amountCents)}</span>
              <button
                type="button"
                title="Remover"
                aria-label="Remover override"
                onClick={() => remove(o.id)}
                className="shrink-0 rounded-sm p-1 text-muted-foreground opacity-0 transition-opacity hover:bg-muted hover:text-rose-500 group-hover:opacity-100"
              >
                <Trash2 className="size-3.5" />
              </button>
            </div>
          ))}
        </div>
      )}

      <FormBody density="compact">
        <Field.Row cols={3}>
          <Field name="ovMonth">
            <Field.Label>Mês</Field.Label>
            <Field.Control>
              <Input type="date" value={month} onChange={(e) => setMonth(e.target.value)} />
            </Field.Control>
          </Field>
          <Field name="ovAmount">
            <Field.Label>Valor (R$)</Field.Label>
            <Field.Control>
              <Input
                type="number"
                min="0"
                step="0.01"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="ex: 30000,00"
              />
            </Field.Control>
          </Field>
          <Field name="ovNote">
            <Field.Label>Nota</Field.Label>
            <Field.Control>
              <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="escopo extra…" />
            </Field.Control>
          </Field>
        </Field.Row>
      </FormBody>
      <div className="mt-1.5 flex justify-end">
        <Button size="sm" variant="outline" onClick={add} disabled={busy || !amount || !month}>
          <Plus className="size-3.5" /> Override
        </Button>
      </div>
    </div>
  );
}
