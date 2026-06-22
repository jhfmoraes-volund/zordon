"use client";

/**
 * Faturamento por encomenda (FP) — seção no drill do projeto (engagementType
 * fixed_scope). Contrato com preço/FP PRÓPRIO do projeto + escopo (FP
 * contratado), e log de entregas de FP (só o entregue vira receita).
 * FP de faturamento ≠ PFV Volund.
 */

import { useCallback, useEffect, useState } from "react";
import { Plus, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Field, FormBody } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { ConfirmDialog, type ConfirmState } from "@/components/ui/confirm-dialog";
import { fetchOrThrow, showErrorToast } from "@/lib/optimistic/toast";
import { brlFromCents, pct } from "@/lib/format-currency";
import { fmtDate } from "@/lib/date-utils";
import { cn } from "@/lib/utils";
import type { Contract, FpDeliveriesResponse, FpDelivery } from "@/lib/finance/types";

function firstOfMonthISO(): string {
  return `${new Date().toISOString().slice(0, 7)}-01`;
}

export function FinanceFpBilling({
  projectId,
  contract,
  onChanged,
}: {
  projectId: string;
  contract: Contract | null;
  onChanged: () => void;
}) {
  const [deliveries, setDeliveries] = useState<FpDelivery[] | null>(null);
  const [confirm, setConfirm] = useState<ConfirmState | null>(null);
  const [saving, setSaving] = useState(false);

  // edição de contrato
  const [editingContract, setEditingContract] = useState(false);
  const [priceReais, setPriceReais] = useState("");
  const [scopeFp, setScopeFp] = useState("");

  // nova entrega
  const [addOpen, setAddOpen] = useState(false);
  const [delMonth, setDelMonth] = useState(firstOfMonthISO());
  const [delFp, setDelFp] = useState("");
  const [delNote, setDelNote] = useState("");

  const pricePerFpCents = contract?.pricePerFpCents ?? null;
  const contractedFp = contract?.contractedFp ?? null;

  const refetch = useCallback(async () => {
    const res = await fetch(`/api/finance/fp-deliveries?projectId=${projectId}`);
    const json = res.ok ? ((await res.json()) as FpDeliveriesResponse) : null;
    setDeliveries(json?.deliveries ?? []);
  }, [projectId]);

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

  const fpDelivered = (deliveries ?? []).reduce((s, d) => s + Number(d.fp_delivered), 0);
  const progress = contractedFp && contractedFp > 0 ? fpDelivered / contractedFp : null;

  function openContractEdit() {
    setPriceReais(pricePerFpCents != null ? (pricePerFpCents / 100).toString() : "");
    setScopeFp(contractedFp != null ? String(contractedFp) : "");
    setEditingContract(true);
  }

  async function saveContract() {
    setSaving(true);
    try {
      await fetchOrThrow("/api/finance/contract", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectId,
          pricePerFpCents: priceReais ? Math.round(parseFloat(priceReais.replace(",", ".")) * 100) : null,
          contractedFp: scopeFp ? parseFloat(scopeFp.replace(",", ".")) : null,
          contractedSprints: contract?.contractedSprints ?? null,
          note: contract?.note ?? null,
        }),
      });
      setEditingContract(false);
      onChanged();
    } catch (e) {
      showErrorToast(e, { label: "Falha ao salvar contrato" });
    } finally {
      setSaving(false);
    }
  }

  async function addDelivery() {
    const fp = parseFloat(delFp.replace(",", "."));
    if (!(fp > 0) || !delMonth) return;
    setSaving(true);
    try {
      await fetchOrThrow("/api/finance/fp-deliveries", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId, month: delMonth, fpDelivered: fp, note: delNote.trim() || null }),
      });
      setAddOpen(false);
      setDelFp("");
      setDelNote("");
      await refetch();
      onChanged();
    } catch (e) {
      showErrorToast(e, { label: "Falha ao registrar entrega" });
    } finally {
      setSaving(false);
    }
  }

  function removeDelivery(d: FpDelivery) {
    setConfirm({
      title: "Remover entrega de FP?",
      description: `${d.fp_delivered} FP em ${fmtDate(d.month)} deixarão de faturar.`,
      destructive: true,
      confirmLabel: "Remover",
      onConfirm: async () => {
        try {
          await fetchOrThrow(`/api/finance/fp-deliveries/${d.id}`, { method: "DELETE" });
          await refetch();
          onChanged();
        } catch (e) {
          showErrorToast(e, { label: "Falha ao remover entrega" });
        }
      },
    });
  }

  return (
    <div>
      <div className="mb-2 flex items-center justify-between px-1">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Faturamento por FP (encomenda)
        </p>
        {!addOpen && pricePerFpCents != null && (
          <Button size="sm" variant="outline" onClick={() => setAddOpen(true)}>
            <Plus className="size-3.5" /> Entrega
          </Button>
        )}
      </div>

      {/* Contrato: preço/FP (próprio do projeto) + escopo */}
      <div className="mb-2 rounded-md border bg-muted/20 p-3">
        {editingContract ? (
          <>
            <FormBody density="compact">
              <Field.Row cols={2}>
                <Field name="price" required>
                  <Field.Label>Preço por FP (R$)</Field.Label>
                  <Field.Control>
                    <Input
                      type="number"
                      min="0"
                      step="0.01"
                      value={priceReais}
                      onChange={(e) => setPriceReais(e.target.value)}
                      placeholder="ex: 1200,00"
                    />
                  </Field.Control>
                </Field>
                <Field name="scope">
                  <Field.Label>Escopo contratado (FP)</Field.Label>
                  <Field.Control>
                    <Input
                      type="number"
                      min="0"
                      step="1"
                      value={scopeFp}
                      onChange={(e) => setScopeFp(e.target.value)}
                      placeholder="ex: 500"
                    />
                  </Field.Control>
                </Field>
              </Field.Row>
            </FormBody>
            <div className="mt-2 flex justify-end gap-2">
              <Button size="sm" variant="ghost" onClick={() => setEditingContract(false)} disabled={saving}>
                Cancelar
              </Button>
              <Button size="sm" onClick={saveContract} disabled={saving}>
                {saving ? "Salvando…" : "Salvar"}
              </Button>
            </div>
          </>
        ) : (
          <div className="flex items-center justify-between gap-3">
            <div className="font-mono text-xs text-muted-foreground">
              {pricePerFpCents != null ? (
                <>
                  <span className="text-foreground">{brlFromCents(pricePerFpCents)}</span>/FP
                  {contractedFp != null && (
                    <>
                      {" · escopo "}
                      <span className="text-foreground">{contractedFp} FP</span>
                      {progress != null && (
                        <>
                          {" · entregue "}
                          <span className="text-foreground">
                            {fpDelivered}/{contractedFp} ({pct(progress)})
                          </span>
                        </>
                      )}
                    </>
                  )}
                </>
              ) : (
                <span>contrato sem preço/FP — defina pra faturar</span>
              )}
            </div>
            <Button size="sm" variant="ghost" onClick={openContractEdit}>
              {pricePerFpCents != null ? "Editar contrato" : "Definir"}
            </Button>
          </div>
        )}
      </div>

      {/* Nova entrega */}
      {addOpen && (
        <div className="mb-2 rounded-md border bg-muted/20 p-3">
          <FormBody density="compact">
            <Field.Row cols={3}>
              <Field name="month" required>
                <Field.Label>Mês</Field.Label>
                <Field.Control>
                  <Input type="date" value={delMonth} onChange={(e) => setDelMonth(e.target.value)} />
                </Field.Control>
              </Field>
              <Field name="fp" required>
                <Field.Label>FP entregue</Field.Label>
                <Field.Control>
                  <Input
                    type="number"
                    min="0"
                    step="0.01"
                    value={delFp}
                    onChange={(e) => setDelFp(e.target.value)}
                    placeholder="ex: 30"
                  />
                </Field.Control>
              </Field>
              <Field name="note">
                <Field.Label>Nota</Field.Label>
                <Field.Control>
                  <Input value={delNote} onChange={(e) => setDelNote(e.target.value)} placeholder="entrega…" />
                </Field.Control>
              </Field>
            </Field.Row>
          </FormBody>
          <div className="mt-2 flex justify-end gap-2">
            <Button size="sm" variant="ghost" onClick={() => setAddOpen(false)} disabled={saving}>
              Cancelar
            </Button>
            <Button size="sm" onClick={addDelivery} disabled={saving}>
              {saving ? "Salvando…" : "Registrar"}
            </Button>
          </div>
        </div>
      )}

      {/* Lista de entregas */}
      {deliveries === null ? (
        <p className="px-1 py-4 text-center text-sm text-muted-foreground">carregando…</p>
      ) : deliveries.length === 0 ? (
        <div className="rounded-md border px-3 py-6 text-center text-sm text-muted-foreground">
          Nenhuma entrega de FP — a receita do projeto é só o que for entregue.
        </div>
      ) : (
        <div className="surface divide-y divide-border/60 overflow-hidden">
          {deliveries.map((d) => (
            <div key={d.id} className="group flex items-center gap-3 px-3 py-2.5">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">
                  {Number(d.fp_delivered)} FP{d.note ? ` · ${d.note}` : ""}
                </p>
                <p className="truncate text-xs text-muted-foreground">{fmtDate(d.month)}</p>
              </div>
              <span className="shrink-0 font-mono text-xs tabular-nums text-muted-foreground">
                {pricePerFpCents != null
                  ? brlFromCents(Math.round(Number(d.fp_delivered) * pricePerFpCents))
                  : "—"}
              </span>
              <button
                type="button"
                title="Remover"
                aria-label="Remover"
                onClick={() => removeDelivery(d)}
                className={cn(
                  "shrink-0 rounded-sm p-1 text-muted-foreground opacity-0 transition-opacity",
                  "hover:bg-muted hover:text-rose-500 group-hover:opacity-100",
                )}
              >
                <Trash2 className="size-3.5" />
              </button>
            </div>
          ))}
        </div>
      )}

      <ConfirmDialog state={confirm} onClose={() => setConfirm(null)} />
    </div>
  );
}
