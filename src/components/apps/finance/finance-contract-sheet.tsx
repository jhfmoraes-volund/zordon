"use client";

/**
 * Sheet de contrato RICO (write) — superfície ÚNICA de escrita do contrato
 * (RB2 2.6). Seções (Slice 1): Termos (valor global→preço/FP derivado) ·
 * Cláusulas & Garantia · Aditivos (override de mês, squad) · Equipe (alocações
 * escopadas, gravam `contract_id`). Canvas = lê; este sheet = escreve.
 * Documentos/upload = Slice 4 (deferido). Reset entre aberturas via `key` no pai.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { Plus, Trash2, Pencil } from "lucide-react";

import {
  ResponsiveSheet,
  ResponsiveSheetBody,
  ResponsiveSheetContent,
  ResponsiveSheetFooter,
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
import { toast } from "sonner";

import { fetchOrThrow, showErrorToast } from "@/lib/optimistic/toast";
import { brlFromCents } from "@/lib/format-currency";
import { fmtDate } from "@/lib/date-utils";
import { positionLabel } from "@/lib/roles";
import { cn } from "@/lib/utils";
import type {
  AllocationItem,
  BillingType,
  ClauseKind,
  Contract,
  ContractClause,
  ContractInput,
  ContractMonthOverride,
  ContractOverridesResponse,
  MemberRef,
  SprintLite,
} from "@/lib/finance/types";

const CLAUSE_LABEL: Record<ClauseKind, string> = {
  sla: "SLA",
  penalty: "Multa",
  ip: "Propriedade intelectual",
  confidentiality: "Confidencialidade",
  readjust: "Reajuste",
  warranty: "Garantia",
  other: "Outra",
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
function firstOfMonthISO(): string {
  return `${new Date().toISOString().slice(0, 7)}-01`;
}

type FormState = {
  label: string;
  billingType: BillingType;
  from: string;
  to: string;
  monthlyFeeReais: string;
  billingCount: string;
  totalValueReais: string;
  contractedFp: string;
  contractedSprints: string;
  warranty: string;
  proposalRef: string;
  note: string;
};

function deriveForm(contract: Contract | null, count: number, engagementType: string | null): FormState {
  if (contract) {
    return {
      label: contract.label,
      billingType: contract.billingType,
      from: contract.effectiveFrom.slice(0, 10),
      to: contract.effectiveTo?.slice(0, 10) ?? "",
      monthlyFeeReais: centsToReais(contract.monthlyFeeCents),
      billingCount: contract.billingCount != null ? String(contract.billingCount) : "",
      totalValueReais: centsToReais(contract.totalValueCents),
      contractedFp: contract.contractedFp != null ? String(contract.contractedFp) : "",
      contractedSprints: contract.contractedSprints != null ? String(contract.contractedSprints) : "",
      warranty: contract.warranty ?? "",
      proposalRef: contract.proposalRef ?? "",
      note: contract.note ?? "",
    };
  }
  return {
    label: `Contrato ${count + 1}`,
    billingType: engagementType === "fixed_scope" ? "fixed_scope" : "squad",
    from: "",
    to: "",
    monthlyFeeReais: "",
    billingCount: "",
    totalValueReais: "",
    contractedFp: "",
    contractedSprints: "",
    warranty: "",
    proposalRef: "",
    note: "",
  };
}

export function FinanceContractSheet({
  open,
  onOpenChange,
  projectId,
  contract,
  contractCount,
  sprints,
  members,
  squadMemberIds,
  allocations,
  clauses,
  engagementType,
  onChanged,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  projectId: string;
  contract: Contract | null;
  contractCount: number;
  sprints: SprintLite[];
  members: MemberRef[];
  squadMemberIds: string[];
  allocations: AllocationItem[];
  clauses: ContractClause[];
  engagementType: string | null;
  onChanged: () => void;
}) {
  const [form, setForm] = useState<FormState>(() => deriveForm(contract, contractCount, engagementType));
  const [saving, setSaving] = useState(false);
  const set = (patch: Partial<FormState>) => setForm((f) => ({ ...f, ...patch }));

  const cid = contract?.id ?? null;
  const isFixed = form.billingType === "fixed_scope";

  const derivedPricePerFpCents = useMemo(() => {
    const total = reaisToCents(form.totalValueReais);
    const fp = numOrNull(form.contractedFp);
    return total != null && fp != null && fp > 0 ? Math.round(total / fp) : null;
  }, [form.totalValueReais, form.contractedFp]);

  const fromSprintId = useMemo(
    () => sprints.find((s) => s.startDate.slice(0, 10) === form.from)?.id ?? "",
    [sprints, form.from],
  );
  const toSprintId = useMemo(
    () => sprints.find((s) => s.endDate.slice(0, 10) === form.to)?.id ?? "",
    [sprints, form.to],
  );

  async function saveContract() {
    if (!form.label.trim() || !form.from) return;
    const body: ContractInput = {
      label: form.label.trim(),
      effectiveFrom: form.from,
      effectiveTo: form.to || null,
      billingType: form.billingType,
      monthlyFeeCents: isFixed ? null : reaisToCents(form.monthlyFeeReais),
      billingCount: isFixed ? null : numOrNull(form.billingCount),
      totalValueCents: isFixed ? reaisToCents(form.totalValueReais) : null,
      contractedFp: isFixed ? numOrNull(form.contractedFp) : null,
      contractedSprints: isFixed ? null : numOrNull(form.contractedSprints),
      warranty: form.warranty.trim() || null,
      proposalRef: form.proposalRef.trim() || null,
      note: form.note.trim() || null,
    };
    setSaving(true);
    try {
      await fetchOrThrow(cid ? `/api/finance/contract/${cid}` : "/api/finance/contract", {
        method: cid ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(cid ? body : { projectId, ...body }),
      });
      onChanged();
      onOpenChange(false);
    } catch (e) {
      showErrorToast(e, { label: "Falha ao salvar contrato" });
    } finally {
      setSaving(false);
    }
  }

  return (
    <ResponsiveSheet open={open} onOpenChange={onOpenChange}>
      <ResponsiveSheetContent size="lg">
        <ResponsiveSheetHeader>
          <ResponsiveSheetTitle>{contract ? `Editar — ${contract.label}` : "Novo contrato"}</ResponsiveSheetTitle>
        </ResponsiveSheetHeader>

        <ResponsiveSheetBody>
          <FormBody density="comfortable">
            {/* ── Termos ── */}
            <Field.Row cols={2}>
              <Field name="label" required>
                <Field.Label>Rótulo</Field.Label>
                <Field.Control>
                  <Input value={form.label} onChange={(e) => set({ label: e.target.value })} placeholder="ex: Piloto" />
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
                        <SelectValue>{(v: string | null) => sprints.find((s) => s.id === v)?.name ?? "—"}</SelectValue>
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
                        <SelectValue>{(v: string | null) => sprints.find((s) => s.id === v)?.name ?? "—"}</SelectValue>
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
                <Field name="totalValue">
                  <Field.Label>Valor global do contrato (R$)</Field.Label>
                  <Field.Control>
                    <Input
                      type="number"
                      min="0"
                      step="0.01"
                      value={form.totalValueReais}
                      onChange={(e) => set({ totalValueReais: e.target.value })}
                      placeholder="ex: 600000,00"
                    />
                  </Field.Control>
                  <Field.Hint>
                    {derivedPricePerFpCents != null
                      ? `Preço/FP derivado: ${brlFromCents(derivedPricePerFpCents)}`
                      : "Preço/FP = valor global ÷ FP contratado"}
                  </Field.Hint>
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
              <>
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
                  <Field name="billingCount">
                    <Field.Label>Nº de mensalidades</Field.Label>
                    <Field.Control>
                      <Input
                        type="number"
                        min="1"
                        step="1"
                        value={form.billingCount}
                        onChange={(e) => set({ billingCount: e.target.value })}
                        placeholder="ex: 3"
                      />
                    </Field.Control>
                    <Field.Hint>
                      {form.billingCount
                        ? `Receita = ${form.billingCount}× a mensalidade (independe da duração da vigência)`
                        : "Quantas vezes se cobra. Vazio = conta os meses da vigência"}
                    </Field.Hint>
                  </Field>
                </Field.Row>
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
              </>
            )}

            {/* ── Cláusulas & Garantia ── */}
            <Field.Row cols={2}>
              <Field name="warranty">
                <Field.Label>Garantia</Field.Label>
                <Field.Control>
                  <Input
                    value={form.warranty}
                    onChange={(e) => set({ warranty: e.target.value })}
                    placeholder="ex: 90 dias pós-entrega"
                  />
                </Field.Control>
              </Field>
              <Field name="proposalRef">
                <Field.Label>Vínculo à proposta</Field.Label>
                <Field.Control>
                  <Input
                    value={form.proposalRef}
                    onChange={(e) => set({ proposalRef: e.target.value })}
                    placeholder="ex: Proposta · Gulf"
                  />
                </Field.Control>
              </Field>
            </Field.Row>

            <Field name="note">
              <Field.Label>Nota</Field.Label>
              <Field.Control>
                <Input value={form.note} onChange={(e) => set({ note: e.target.value })} placeholder="condições, observações…" />
              </Field.Control>
            </Field>
          </FormBody>

          {/* Seções de filhos: só com o contrato salvo (precisam de contract_id). */}
          {cid ? (
            <div className="mt-5 space-y-5">
              <ClauseEditor contractId={cid} clauses={clauses.filter((c) => c.contractId === cid)} onChanged={onChanged} />
              {!isFixed && (
                <div className="border-t pt-4">
                  <MonthOverrides contractId={cid} onChanged={onChanged} />
                </div>
              )}
              <div className="border-t pt-4">
                <ContractTeamEditor
                  projectId={projectId}
                  contractId={cid}
                  allocations={allocations}
                  members={members}
                  squadMemberIds={squadMemberIds}
                  onChanged={onChanged}
                />
              </div>
            </div>
          ) : (
            <p className="mt-5 border-t pt-4 text-[12px] text-muted-foreground">
              Salve o contrato para adicionar cláusulas, aditivos de mês e equipe.
            </p>
          )}
        </ResponsiveSheetBody>

        <ResponsiveSheetFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            Fechar
          </Button>
          <Button onClick={saveContract} disabled={saving || !form.label.trim() || !form.from}>
            {saving ? "Salvando…" : "Salvar contrato"}
          </Button>
        </ResponsiveSheetFooter>
      </ResponsiveSheetContent>
    </ResponsiveSheet>
  );
}

/** Cláusulas (1-N) — list + add/remove via /api/finance/contract-clause. */
function ClauseEditor({
  contractId,
  clauses,
  onChanged,
}: {
  contractId: string;
  clauses: ContractClause[];
  onChanged: () => void;
}) {
  const [kind, setKind] = useState<ClauseKind>("other");
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);

  async function add() {
    if (!text.trim()) return;
    setBusy(true);
    try {
      await fetchOrThrow("/api/finance/contract-clause", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contractId, kind, text: text.trim() }),
      });
      setText("");
      setKind("other");
      onChanged();
    } catch (e) {
      showErrorToast(e, { label: "Falha ao adicionar cláusula" });
    } finally {
      setBusy(false);
    }
  }
  async function remove(id: string) {
    try {
      await fetchOrThrow(`/api/finance/contract-clause/${id}`, { method: "DELETE" });
      onChanged();
    } catch (e) {
      showErrorToast(e, { label: "Falha ao remover cláusula" });
    }
  }

  return (
    <div>
      <p className="mb-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
        Cláusulas
      </p>
      {clauses.length > 0 && (
        <div className="mb-2 surface divide-y divide-border/60 overflow-hidden rounded-md">
          {clauses.map((c) => (
            <div key={c.id} className="group flex items-center gap-2 px-3 py-2 text-sm">
              <span className="shrink-0 rounded-sm border px-1.5 py-px text-[10px] text-muted-foreground">
                {CLAUSE_LABEL[c.kind]}
              </span>
              <span className="min-w-0 flex-1 truncate">{c.text}</span>
              <button
                type="button"
                title="Remover"
                aria-label="Remover cláusula"
                onClick={() => remove(c.id)}
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
          <Field name="clauseKind">
            <Field.Label>Tipo</Field.Label>
            <Field.Control>
              <Select value={kind} onValueChange={(v) => v && setKind(v as ClauseKind)}>
                <SelectTrigger>
                  <SelectValue>{(v: string | null) => (v ? CLAUSE_LABEL[v as ClauseKind] : "")}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {(Object.keys(CLAUSE_LABEL) as ClauseKind[]).map((k) => (
                    <SelectItem key={k} value={k}>
                      {CLAUSE_LABEL[k]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field.Control>
          </Field>
          <Field name="clauseText" className="col-span-2">
            <Field.Label>Texto</Field.Label>
            <Field.Control>
              <Input value={text} onChange={(e) => setText(e.target.value)} placeholder="ex: SLA de correção: 5 dias úteis" />
            </Field.Control>
          </Field>
        </Field.Row>
      </FormBody>
      <div className="mt-1.5 flex justify-end">
        <Button size="sm" variant="outline" onClick={add} disabled={busy || !text.trim()}>
          <Plus className="size-3.5" /> Cláusula
        </Button>
      </div>
    </div>
  );
}

/** Equipe do contrato — alocações que gravam `contract_id`. Mostra também as
 *  não atribuídas (legado contract_id null) com ação de atribuir a este contrato. */
function ContractTeamEditor({
  projectId,
  contractId,
  allocations,
  members,
  squadMemberIds,
  onChanged,
}: {
  projectId: string;
  contractId: string;
  allocations: AllocationItem[];
  members: MemberRef[];
  squadMemberIds: string[];
  onChanged: () => void;
}) {
  type AllocForm = { id: string | null; memberId: string; percent: string; from: string; to: string };
  const [form, setForm] = useState<AllocForm | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState<ConfirmState | null>(null);

  const mine = allocations.filter((a) => a.contract_id === contractId);
  const unassigned = allocations.filter((a) => a.contract_id === null);

  const memberOptions = useMemo(() => {
    const squad = new Set(squadMemberIds);
    return members
      .filter((m) => !m.isExternal)
      .sort((a, b) => (squad.has(a.id) ? 0 : 1) - (squad.has(b.id) ? 0 : 1) || a.name.localeCompare(b.name));
  }, [members, squadMemberIds]);

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

  async function save() {
    if (!form) return;
    const percent = parseFloat(form.percent.replace(",", "."));
    if (!form.memberId || !(percent > 0 && percent <= 100) || !form.from) return;
    setBusy(true);
    try {
      const res = await fetchOrThrow(
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
            contractId,
          }),
        },
      );
      const { warning } = (await res.json().catch(() => ({}))) as { warning?: string | null };
      if (warning) toast.warning(warning);
      setForm(null);
      onChanged();
    } catch (e) {
      showErrorToast(e, { label: "Falha ao salvar alocação" });
    } finally {
      setBusy(false);
    }
  }

  async function assign(a: AllocationItem) {
    try {
      await fetchOrThrow(`/api/finance/allocations/${a.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          memberId: a.member_id,
          projectId,
          percent: a.percent,
          effectiveFrom: a.effective_from,
          effectiveTo: a.effective_to,
          contractId,
        }),
      });
      onChanged();
    } catch (e) {
      showErrorToast(e, { label: "Falha ao atribuir alocação" });
    }
  }

  function remove(a: AllocationItem) {
    setConfirm({
      title: "Remover alocação?",
      description: `${a.memberName} deixará de compor o custo de equipe deste contrato.`,
      destructive: true,
      confirmLabel: "Remover",
      onConfirm: async () => {
        try {
          await fetchOrThrow(`/api/finance/allocations/${a.id}`, { method: "DELETE" });
          onChanged();
        } catch (e) {
          showErrorToast(e, { label: "Falha ao remover alocação" });
        }
      },
    });
  }

  return (
    <div>
      <div className="mb-1.5 flex items-center justify-between">
        <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
          Equipe nesta vigência
        </p>
        {!form && (
          <Button size="sm" variant="outline" onClick={openAdd}>
            <Plus className="size-3.5" /> Membro
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
                  <Select value={form.memberId} onValueChange={(v) => setForm((f) => (f ? { ...f, memberId: v ?? "" } : f))}>
                    <SelectTrigger>
                      <SelectValue>
                        {(v: string | null) => memberOptions.find((m) => m.id === v)?.name ?? "Selecione…"}
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
                  <Input type="date" value={form.from} onChange={(e) => setForm((f) => (f ? { ...f, from: e.target.value } : f))} />
                </Field.Control>
              </Field>
              <Field name="to">
                <Field.Label>Fim (opcional)</Field.Label>
                <Field.Control>
                  <Input type="date" value={form.to} onChange={(e) => setForm((f) => (f ? { ...f, to: e.target.value } : f))} />
                </Field.Control>
              </Field>
            </Field.Row>
          </FormBody>
          <div className="mt-2 flex justify-end gap-2">
            <Button size="sm" variant="ghost" onClick={() => setForm(null)} disabled={busy}>
              Cancelar
            </Button>
            <Button size="sm" onClick={save} disabled={busy}>
              {busy ? "Salvando…" : "Salvar"}
            </Button>
          </div>
        </div>
      )}

      {mine.length === 0 ? (
        <p className="rounded-md border px-3 py-4 text-center text-xs text-muted-foreground">
          Ninguém alocado a este contrato.
        </p>
      ) : (
        <div className="surface divide-y divide-border/60 overflow-hidden rounded-md">
          {mine.map((a) => (
            <div key={a.id} className="group flex items-center gap-3 px-3 py-2">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{a.memberName}</p>
                <p className="truncate text-xs text-muted-foreground">
                  {a.percent}% · {fmtDate(a.effective_from)} → {a.effective_to ? fmtDate(a.effective_to) : "atual"}
                </p>
              </div>
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
                  onClick={() => remove(a)}
                  className="rounded-sm p-1 text-muted-foreground opacity-0 transition-opacity hover:bg-muted hover:text-rose-500 group-hover:opacity-100"
                >
                  <Trash2 className="size-3.5" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {unassigned.length > 0 && (
        <div className="mt-2">
          <p className="mb-1 text-[10px] uppercase tracking-wide text-muted-foreground">
            Sem contrato — atribuir a este
          </p>
          <div className="surface divide-y divide-border/60 overflow-hidden rounded-md">
            {unassigned.map((a) => (
              <div key={a.id} className="flex items-center gap-3 px-3 py-2">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm">{a.memberName}</p>
                  <p className="truncate text-xs text-muted-foreground">
                    {a.percent}% · {fmtDate(a.effective_from)} → {a.effective_to ? fmtDate(a.effective_to) : "atual"}
                  </p>
                </div>
                <Button size="sm" variant="outline" onClick={() => assign(a)}>
                  Atribuir
                </Button>
              </div>
            ))}
          </div>
        </div>
      )}

      <ConfirmDialog state={confirm} onClose={() => setConfirm(null)} />
    </div>
  );
}

/** Overrides de valor por mês (substituem a mensalidade base só no mês indicado). */
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
    const cents = reaisToCents(amount);
    if (cents == null || !(cents >= 0) || !month) return;
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
      showErrorToast(e, { label: "Falha ao salvar aditivo" });
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
      showErrorToast(e, { label: "Falha ao remover aditivo" });
    }
  }

  return (
    <div>
      <p className="mb-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
        Aditivos por mês <span className="font-normal normal-case">(substitui a mensalidade no mês)</span>
      </p>

      {overrides && overrides.length > 0 && (
        <div className="mb-2 surface divide-y divide-border/60 overflow-hidden rounded-md">
          {overrides.map((o) => (
            <div key={o.id} className={cn("group flex items-center gap-3 px-3 py-2")}>
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
                aria-label="Remover aditivo"
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
          <Plus className="size-3.5" /> Aditivo
        </Button>
      </div>
    </div>
  );
}
