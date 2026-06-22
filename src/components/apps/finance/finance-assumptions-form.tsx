"use client";

/**
 * Editor de premissas (impostos, SG&A, custos por pessoa) — global ou override
 * por projeto. Defaults vêm da planilha Hitz. % são editados em pontos
 * percentuais; dinheiro em R$. Ver docs/features/finance/pricing-pnl-model.md.
 */

import { useEffect, useState } from "react";

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
import { Button } from "@/components/ui/button";
import { fetchOrThrow, showErrorToast } from "@/lib/optimistic/toast";
import type { AssumptionsInput, AssumptionsResponse } from "@/lib/finance/types";

type FieldKind = "pct" | "money" | "int";
const FIELDS: { key: keyof AssumptionsInput; label: string; kind: FieldKind }[] = [
  { key: "issPct", label: "ISS (%)", kind: "pct" },
  { key: "pisPct", label: "PIS (%)", kind: "pct" },
  { key: "cofinsPct", label: "COFINS (%)", kind: "pct" },
  { key: "sgaPct", label: "SG&A (%)", kind: "pct" },
  { key: "financialCostPct", label: "Custo financeiro/mês (%)", kind: "pct" },
  { key: "irpjCsllPct", label: "IRPJ/CSLL (%)", kind: "pct" },
  { key: "targetMarginPct", label: "Margem alvo (%)", kind: "pct" },
  { key: "hoursPerFte", label: "Horas/mês por FTE", kind: "int" },
  { key: "aiPerFteCents", label: "IA por FTE (R$/mês)", kind: "money" },
  { key: "softwarePerHeadCents", label: "Software por pessoa (R$/mês)", kind: "money" },
  { key: "equipCapexCents", label: "Equipamento (R$, CAPEX)", kind: "money" },
  { key: "equipLifeMonths", label: "Vida útil equip. (meses)", kind: "int" },
];

function toDisplay(value: number, kind: FieldKind): string {
  if (kind === "pct") return String(Math.round(value * 1000000) / 10000); // fração → %
  if (kind === "money") return String(value / 100);
  return String(value);
}
function fromDisplay(s: string, kind: FieldKind): number {
  const n = parseFloat(s.replace(",", ".")) || 0;
  if (kind === "pct") return n / 100;
  if (kind === "money") return Math.round(n * 100);
  return Math.round(n);
}

export function FinanceAssumptionsForm({
  open,
  onOpenChange,
  projectId,
  scopeLabel,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  projectId: string | null; // null = global
  scopeLabel: string;
  onSaved: () => void;
}) {
  const [form, setForm] = useState<Record<string, string> | null>(null);
  const [isOverride, setIsOverride] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const qs = projectId ? `?projectId=${projectId}` : "";
      const res = await fetch(`/api/finance/assumptions${qs}`);
      const json = res.ok ? ((await res.json()) as AssumptionsResponse) : null;
      if (cancelled || !json) return;
      const a = json.assumptions;
      const next: Record<string, string> = {};
      for (const f of FIELDS) next[f.key] = toDisplay(a[f.key] as number, f.kind);
      setForm(next);
      setIsOverride(json.isOverride);
    })();
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  async function save() {
    if (!form) return;
    const input: Record<string, number> = {};
    for (const f of FIELDS) input[f.key] = fromDisplay(form[f.key] ?? "0", f.kind);
    setSaving(true);
    try {
      await fetchOrThrow("/api/finance/assumptions", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId, ...input }),
      });
      onSaved();
      onOpenChange(false);
    } catch (e) {
      showErrorToast(e, { label: "Falha ao salvar premissas" });
    } finally {
      setSaving(false);
    }
  }

  async function revertToGlobal() {
    if (!projectId) return;
    setSaving(true);
    try {
      await fetchOrThrow(`/api/finance/assumptions?projectId=${projectId}`, { method: "DELETE" });
      onSaved();
      onOpenChange(false);
    } catch (e) {
      showErrorToast(e, { label: "Falha ao reverter premissas" });
    } finally {
      setSaving(false);
    }
  }

  return (
    <ResponsiveSheet open={open} onOpenChange={onOpenChange}>
      <ResponsiveSheetContent size="md">
        <ResponsiveSheetHeader>
          <ResponsiveSheetTitle>{scopeLabel}</ResponsiveSheetTitle>
        </ResponsiveSheetHeader>

        <ResponsiveSheetBody>
          {!form ? (
            <p className="px-1 py-8 text-center text-sm text-muted-foreground">carregando…</p>
          ) : (
            <>
              {projectId && !isOverride && (
                <p className="mb-3 rounded-md border border-dashed px-3 py-2 text-[11px] text-muted-foreground">
                  Este projeto usa as premissas globais. Salvar aqui cria um override só dele.
                </p>
              )}
              <FormBody density="compact">
                {Array.from({ length: Math.ceil(FIELDS.length / 2) }).map((_, i) => {
                  const a = FIELDS[i * 2];
                  const b = FIELDS[i * 2 + 1];
                  return (
                    <Field.Row key={a.key} cols={2}>
                      {[a, b].filter(Boolean).map((f) => (
                        <Field key={f.key} name={f.key}>
                          <Field.Label>{f.label}</Field.Label>
                          <Field.Control>
                            <Input
                              type="number"
                              step="any"
                              inputMode="decimal"
                              value={form[f.key] ?? ""}
                              onChange={(e) =>
                                setForm((s) => (s ? { ...s, [f.key]: e.target.value } : s))
                              }
                            />
                          </Field.Control>
                        </Field>
                      ))}
                    </Field.Row>
                  );
                })}
              </FormBody>
            </>
          )}
        </ResponsiveSheetBody>

        <ResponsiveSheetFooter>
          {projectId && isOverride && (
            <Button variant="ghost" onClick={revertToGlobal} disabled={saving}>
              Usar global
            </Button>
          )}
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            Cancelar
          </Button>
          <Button onClick={save} disabled={saving || !form}>
            {saving ? "Salvando…" : "Salvar"}
          </Button>
        </ResponsiveSheetFooter>
      </ResponsiveSheetContent>
    </ResponsiveSheet>
  );
}
