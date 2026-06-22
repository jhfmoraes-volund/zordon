"use client";

/**
 * Entregas de FP (encomenda / fixed_scope) — só o entregue vira receita, ao
 * preço/FP do contrato vigente no mês da entrega. O contrato (preço, escopo,
 * vigência) é editado na seção Contratos; aqui é só o log de entregas.
 * FP de faturamento ≠ PFV Volund.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
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
import { contractForDate } from "./contract-bands";

function firstOfMonthISO(): string {
  return `${new Date().toISOString().slice(0, 7)}-01`;
}

export function FinanceFpBilling({
  projectId,
  contracts,
  onChanged,
}: {
  projectId: string;
  contracts: Contract[];
  onChanged: () => void;
}) {
  const [deliveries, setDeliveries] = useState<FpDelivery[] | null>(null);
  const [confirm, setConfirm] = useState<ConfirmState | null>(null);
  const [saving, setSaving] = useState(false);

  const [addOpen, setAddOpen] = useState(false);
  const [delMonth, setDelMonth] = useState(firstOfMonthISO());
  const [delFp, setDelFp] = useState("");
  const [delNote, setDelNote] = useState("");

  // Contrato encomenda com preço/FP definido (qualquer vigência) → habilita entregas.
  const priced = useMemo(
    () => contracts.some((c) => c.billingType === "fixed_scope" && c.pricePerFpCents != null),
    [contracts],
  );
  const totalContractedFp = useMemo(
    () => contracts.reduce((s, c) => s + (c.contractedFp ?? 0), 0),
    [contracts],
  );

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
  const progress = totalContractedFp > 0 ? fpDelivered / totalContractedFp : null;

  /** Preço/FP do contrato vigente no mês da entrega (mesma regra da view). */
  function priceForMonth(monthISO: string): number | null {
    return contractForDate(contracts, monthISO)?.pricePerFpCents ?? null;
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
          Entregas de FP (encomenda)
        </p>
        {!addOpen && priced && (
          <Button size="sm" variant="outline" onClick={() => setAddOpen(true)}>
            <Plus className="size-3.5" /> Entrega
          </Button>
        )}
      </div>

      {!priced && (
        <div className="mb-2 rounded-md border bg-muted/20 px-3 py-2 text-xs text-muted-foreground">
          Defina um contrato <span className="text-foreground">Encomenda</span> com preço/FP na seção
          Contratos pra registrar entregas.
        </div>
      )}

      {priced && progress != null && (
        <div className="mb-2 rounded-md border bg-muted/20 px-3 py-2 font-mono text-xs text-muted-foreground">
          entregue{" "}
          <span className="text-foreground">
            {fpDelivered}/{totalContractedFp} FP ({pct(progress)})
          </span>
        </div>
      )}

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

      {deliveries === null ? (
        <p className="px-1 py-4 text-center text-sm text-muted-foreground">carregando…</p>
      ) : deliveries.length === 0 ? (
        priced && (
          <div className="rounded-md border px-3 py-6 text-center text-sm text-muted-foreground">
            Nenhuma entrega de FP — a receita do projeto é só o que for entregue.
          </div>
        )
      ) : (
        <div className="surface divide-y divide-border/60 overflow-hidden">
          {deliveries.map((d) => {
            const price = priceForMonth(d.month);
            return (
              <div key={d.id} className="group flex items-center gap-3 px-3 py-2.5">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">
                    {Number(d.fp_delivered)} FP{d.note ? ` · ${d.note}` : ""}
                  </p>
                  <p className="truncate text-xs text-muted-foreground">{fmtDate(d.month)}</p>
                </div>
                <span className="shrink-0 font-mono text-xs tabular-nums text-muted-foreground">
                  {price != null ? brlFromCents(Math.round(Number(d.fp_delivered) * price)) : "—"}
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
            );
          })}
        </div>
      )}

      <ConfirmDialog state={confirm} onClose={() => setConfirm(null)} />
    </div>
  );
}
