"use client";

/**
 * Sheet "Emitir NF" (write) — cria/edita uma `invoice` (NF operacional por mês).
 * Q4/D9: NF é SÓ cobrança/caixa, NÃO reconcilia a receita da DRE. Q2: 4 estados
 * (pending → issued=**NF emitida** → received=Recebido · + cancelled). Copy:
 * **"NF emitida", NUNCA "Faturado"**. Criação é HUMANA (sem agente — Q1).
 * Padrão ResponsiveSheet + Field/FormBody; reset entre aberturas via `key` no pai.
 */

import { useState } from "react";

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
import { fetchOrThrow, showErrorToast } from "@/lib/optimistic/toast";
import type {
  Contract,
  Invoice,
  InvoiceConditionKind,
  InvoiceInput,
  InvoiceStatus,
} from "@/lib/finance/types";

const STATUS_LABEL: Record<InvoiceStatus, string> = {
  pending: "Pendente",
  issued: "NF emitida", // NUNCA "Faturado"
  received: "Recebido",
  cancelled: "Cancelada",
};
const COND_LABEL: Record<InvoiceConditionKind, string> = {
  pf_sheet: "Planilha de PF",
  sow: "SOW",
  none: "Nenhuma",
};

function reaisToCents(s: string): number | null {
  const n = parseFloat(s.replace(",", "."));
  return Number.isFinite(n) ? Math.round(n * 100) : null;
}
function centsToReais(c: number | null): string {
  return c != null ? (c / 100).toString() : "";
}
function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

function deriveInitial(invoice: Invoice | null | undefined, contract: Contract, defaultMonth?: string) {
  if (invoice) {
    return {
      competenceMonth: invoice.competenceMonth.slice(0, 7),
      amountReais: centsToReais(invoice.amountCents),
      receivedNetReais: centsToReais(invoice.receivedNetCents),
      number: invoice.number ?? "",
      status: invoice.status,
      issuedAt: invoice.issuedAt ?? "",
      receivedAt: invoice.receivedAt ?? "",
      dueAt: invoice.dueAt ?? "",
      conditionKind: (invoice.conditionKind ?? "none") as InvoiceConditionKind,
      conditionMet: invoice.conditionMet,
    };
  }
  // Novo: emitindo agora — pré-preenche status/condição pelo tipo do contrato.
  return {
    competenceMonth: (defaultMonth ?? todayISO()).slice(0, 7),
    amountReais: contract.billingType === "squad" ? centsToReais(contract.monthlyFeeCents) : "",
    receivedNetReais: "",
    number: "",
    status: "issued" as InvoiceStatus,
    issuedAt: todayISO(),
    receivedAt: "",
    dueAt: "",
    conditionKind: (contract.billingType === "fixed_scope" ? "pf_sheet" : "sow") as InvoiceConditionKind,
    conditionMet: true,
  };
}

export function FinanceInvoiceSheet({
  open,
  onOpenChange,
  contract,
  invoice,
  defaultMonth,
  onChanged,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  contract: Contract;
  invoice?: Invoice | null;
  defaultMonth?: string;
  onChanged: () => void;
}) {
  const [init] = useState(() => deriveInitial(invoice, contract, defaultMonth));
  const [competenceMonth, setCompetenceMonth] = useState(init.competenceMonth);
  const [amountReais, setAmountReais] = useState(init.amountReais);
  const [receivedNetReais, setReceivedNetReais] = useState(init.receivedNetReais);
  const [number, setNumber] = useState(init.number);
  const [status, setStatus] = useState<InvoiceStatus>(init.status);
  const [issuedAt, setIssuedAt] = useState(init.issuedAt);
  const [receivedAt, setReceivedAt] = useState(init.receivedAt);
  const [dueAt, setDueAt] = useState(init.dueAt);
  const [conditionKind, setConditionKind] = useState<InvoiceConditionKind>(init.conditionKind);
  const [conditionMet, setConditionMet] = useState(init.conditionMet);
  const [saving, setSaving] = useState(false);
  const [confirm, setConfirm] = useState<ConfirmState | null>(null);

  const amountCents = reaisToCents(amountReais);
  const amountValid = amountCents != null && amountCents >= 0;
  const canSave = !!competenceMonth && amountValid && !saving;

  async function handleSave() {
    if (!canSave || amountCents == null) return;
    const payload: InvoiceInput = {
      contractId: contract.id,
      competenceMonth,
      amountCents,
      receivedNetCents: receivedNetReais ? reaisToCents(receivedNetReais) : null,
      number: number.trim() || null,
      status,
      issuedAt: issuedAt || null,
      receivedAt: receivedAt || null,
      dueAt: dueAt || null,
      conditionKind,
      conditionMet,
    };
    setSaving(true);
    try {
      await fetchOrThrow(invoice ? `/api/finance/invoice/${invoice.id}` : "/api/finance/invoice", {
        method: invoice ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      onChanged();
      onOpenChange(false);
    } catch (e) {
      showErrorToast(e, { label: invoice ? "Falha ao salvar NF" : "Falha ao emitir NF" });
    } finally {
      setSaving(false);
    }
  }

  function handleDelete() {
    if (!invoice) return;
    setConfirm({
      title: "Remover esta NF?",
      description: "A nota fiscal será apagada do rastreio. Para manter o histórico, use o status “Cancelada”.",
      destructive: true,
      confirmLabel: "Remover",
      onConfirm: async () => {
        try {
          await fetchOrThrow(`/api/finance/invoice/${invoice.id}`, { method: "DELETE" });
          onChanged();
          onOpenChange(false);
        } catch (e) {
          showErrorToast(e, { label: "Falha ao remover NF" });
        }
      },
    });
  }

  return (
    <ResponsiveSheet open={open} onOpenChange={onOpenChange}>
      <ResponsiveSheetContent size="md">
        <ResponsiveSheetHeader>
          <ResponsiveSheetTitle>{invoice ? "Editar NF" : "Emitir NF"}</ResponsiveSheetTitle>
          <p className="font-mono text-[11px] text-muted-foreground">{contract.label}</p>
        </ResponsiveSheetHeader>

        <ResponsiveSheetBody>
          <FormBody density="comfortable">
            <Field.Row cols={2}>
              <Field name="competence" required>
                <Field.Label>Mês de competência</Field.Label>
                <Field.Control>
                  <Input
                    type="month"
                    value={competenceMonth}
                    onChange={(e) => setCompetenceMonth(e.target.value)}
                  />
                </Field.Control>
              </Field>
              <Field name="status" required>
                <Field.Label>Status</Field.Label>
                <Field.Control>
                  <Select value={status} onValueChange={(v) => v && setStatus(v as InvoiceStatus)}>
                    <SelectTrigger>
                      <SelectValue>
                        {(v: string | null) => (v ? STATUS_LABEL[v as InvoiceStatus] : "")}
                      </SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      {(["pending", "issued", "received", "cancelled"] as InvoiceStatus[]).map((s) => (
                        <SelectItem key={s} value={s}>
                          {STATUS_LABEL[s]}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field.Control>
              </Field>
            </Field.Row>

            <Field.Row cols={2}>
              <Field
                name="amount"
                required
                error={amountReais !== "" && !amountValid ? "Valor inválido" : undefined}
              >
                <Field.Label>Valor bruto (R$)</Field.Label>
                <Field.Control>
                  <Input
                    type="number"
                    min="0"
                    step="0.01"
                    inputMode="decimal"
                    value={amountReais}
                    onChange={(e) => setAmountReais(e.target.value)}
                    placeholder="0,00"
                  />
                </Field.Control>
                <Field.Hint>valor da nota (impostos descritivos — não reconciliam a DRE)</Field.Hint>
              </Field>
              <Field name="net">
                <Field.Label>Líquido recebido (R$)</Field.Label>
                <Field.Control>
                  <Input
                    type="number"
                    min="0"
                    step="0.01"
                    inputMode="decimal"
                    value={receivedNetReais}
                    onChange={(e) => setReceivedNetReais(e.target.value)}
                    placeholder="após retenção"
                  />
                </Field.Control>
              </Field>
            </Field.Row>

            <Field.Row cols={2}>
              <Field name="number">
                <Field.Label>Número da NF</Field.Label>
                <Field.Control>
                  <Input value={number} onChange={(e) => setNumber(e.target.value)} placeholder="ex: 0052" />
                </Field.Control>
              </Field>
              <Field name="dueAt">
                <Field.Label>Vencimento</Field.Label>
                <Field.Control>
                  <Input type="date" value={dueAt} onChange={(e) => setDueAt(e.target.value)} />
                </Field.Control>
              </Field>
            </Field.Row>

            <Field.Row cols={2}>
              <Field name="issuedAt">
                <Field.Label>Data de emissão</Field.Label>
                <Field.Control>
                  <Input type="date" value={issuedAt} onChange={(e) => setIssuedAt(e.target.value)} />
                </Field.Control>
              </Field>
              <Field name="receivedAt">
                <Field.Label>Data de recebimento</Field.Label>
                <Field.Control>
                  <Input type="date" value={receivedAt} onChange={(e) => setReceivedAt(e.target.value)} />
                </Field.Control>
              </Field>
            </Field.Row>

            <Field.Row cols={2}>
              <Field name="conditionKind">
                <Field.Label>Condição p/ emitir</Field.Label>
                <Field.Control>
                  <Select
                    value={conditionKind}
                    onValueChange={(v) => v && setConditionKind(v as InvoiceConditionKind)}
                  >
                    <SelectTrigger>
                      <SelectValue>
                        {(v: string | null) => (v ? COND_LABEL[v as InvoiceConditionKind] : "")}
                      </SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      {(["pf_sheet", "sow", "none"] as InvoiceConditionKind[]).map((k) => (
                        <SelectItem key={k} value={k}>
                          {COND_LABEL[k]}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field.Control>
              </Field>
              <Field name="conditionMet">
                <Field.Label>Condição atendida?</Field.Label>
                <Field.Control>
                  <Select
                    value={conditionMet ? "yes" : "no"}
                    onValueChange={(v) => setConditionMet(v === "yes")}
                  >
                    <SelectTrigger>
                      <SelectValue>
                        {(v: string | null) => (v === "yes" ? "Atendida" : "Pendente")}
                      </SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="yes">Atendida</SelectItem>
                      <SelectItem value="no">Pendente</SelectItem>
                    </SelectContent>
                  </Select>
                </Field.Control>
              </Field>
            </Field.Row>
            {/* Anexo XML/PDF da NF = Slice 4 (deferido). */}
          </FormBody>
        </ResponsiveSheetBody>

        <ResponsiveSheetFooter>
          {invoice && (
            <Button variant="ghost" onClick={handleDelete} disabled={saving} className="mr-auto text-rose-500 hover:text-rose-600">
              Remover
            </Button>
          )}
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            Cancelar
          </Button>
          <Button onClick={handleSave} disabled={!canSave}>
            {saving ? "Salvando…" : invoice ? "Salvar" : "Emitir NF"}
          </Button>
        </ResponsiveSheetFooter>
      </ResponsiveSheetContent>

      <ConfirmDialog state={confirm} onClose={() => setConfirm(null)} />
    </ResponsiveSheet>
  );
}
