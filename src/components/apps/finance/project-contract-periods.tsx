"use client";

/**
 * Período dos contratos no TAB do projeto (Slice 3 · Batch B) — legível por quem
 * vê o projeto, fora do app Finanças (admin-only). Lê /api/finance/contract-period,
 * cuja view (finance.v_contract_period) filtra por can_view_project OR is_admin e
 * projeta SÓ período/identidade — nunca valores. Renderiza `null` quando não há
 * período visível (sem acesso ou projeto sem contrato), então é seguro montar em
 * qualquer lugar. Edição do contrato segue admin-only no app Finanças (Q3).
 */

import { useEffect, useState } from "react";
import { FileText } from "lucide-react";

import { fmtDate } from "@/lib/date-utils";
import { cn } from "@/lib/utils";
import type { ContractPeriod, ContractPeriodsResponse } from "@/lib/finance/types";
import { paletteFor } from "./contract-bands";

export function ProjectContractPeriods({ projectId }: { projectId: string }) {
  const [periods, setPeriods] = useState<ContractPeriod[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/finance/contract-period?projectId=${projectId}`)
      .then((r) => (r.ok ? (r.json() as Promise<ContractPeriodsResponse>) : null))
      .then((d) => {
        if (!cancelled) setPeriods(d?.periods ?? []);
      })
      .catch(() => {
        if (!cancelled) setPeriods([]);
      });
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  // Sem período visível (sem acesso / sem contrato) → invisível, sem ocupar espaço.
  if (!periods || periods.length === 0) return null;

  return (
    <div className="overflow-hidden rounded-md border">
      <div className="flex items-center gap-1.5 border-b bg-muted/30 px-3 py-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
        <FileText className="size-3.5" /> Contratos
      </div>
      <div className="divide-y divide-border/60">
        {periods.map((p) => {
          const pal = paletteFor(p.seq);
          return (
            <div key={p.contractId} className="flex items-center gap-2.5 px-3 py-2">
              <span aria-hidden className={cn("size-2 shrink-0 rounded-full", pal.dot)} />
              <span className="truncate text-sm font-medium">{p.label}</span>
              <span className={cn("shrink-0 rounded-sm border px-1 py-px text-[10px]", pal.border, pal.text)}>
                {p.billingType === "fixed_scope" ? "Encomenda" : "Squad"}
              </span>
              <span className="ml-auto shrink-0 font-mono text-xs tabular-nums text-muted-foreground">
                {fmtDate(p.effectiveFrom)} → {p.effectiveTo ? fmtDate(p.effectiveTo) : "atual"}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
