"use client";

/**
 * App Contratos (project-scoped, PM+) — superfície READ-ONLY. Mostra os contratos
 * que regem o projeto (vigência, tipo de faturamento, status) e a equipe alocada
 * por contrato (nome, cargo, % contratual) — NUNCA valores em R$ (custo/salário/
 * preço seguem admin-only no app Finanças). Lê duas projeções PM-safe:
 *   - /api/finance/contract-period  → identidade/vigência/status (view v_contract_period)
 *   - /api/finance/contract-roster  → equipe sem valores      (view v_contract_roster)
 * Gate de visibilidade é manager+ (registry minAccessLevel) + can_view_project (RLS).
 * Edição do contrato continua no Finanças (admin). Sem mutações aqui.
 */

import { useEffect, useMemo, useState } from "react";
import { CalendarRange, FileText, Users } from "lucide-react";

import { StatusChip } from "@/components/ui/status-chip";
import { Skeleton } from "@/components/ui/skeleton";
import { CONTRACT_STATUS } from "@/lib/status-chips";
import { POSITION_LABELS, type Position } from "@/lib/roles";
import { fmtDate } from "@/lib/date-utils";
import { cn } from "@/lib/utils";
import type {
  BillingType,
  ContractPeriod,
  ContractPeriodsResponse,
  ContractRosterMember,
  ContractRosterResponse,
} from "@/lib/finance/types";
import { paletteFor } from "./contract-bands";

function billingLabel(b: BillingType): string {
  return b === "fixed_scope" ? "Encomenda" : "Squad";
}

function positionLabel(p: string | null): string {
  if (!p) return "—";
  return POSITION_LABELS[p as Position] ?? p;
}

export function ProjectContractApp({ projectId }: { projectId: string }) {
  const [periods, setPeriods] = useState<ContractPeriod[] | null>(null);
  const [roster, setRoster] = useState<ContractRosterMember[] | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      fetch(`/api/finance/contract-period?projectId=${projectId}`).then((r) =>
        r.ok ? (r.json() as Promise<ContractPeriodsResponse>) : Promise.reject(),
      ),
      fetch(`/api/finance/contract-roster?projectId=${projectId}`).then((r) =>
        r.ok ? (r.json() as Promise<ContractRosterResponse>) : Promise.reject(),
      ),
    ])
      .then(([p, ro]) => {
        if (cancelled) return;
        setPeriods(p.periods);
        setRoster(ro.roster);
      })
      .catch(() => {
        if (!cancelled) setError(true);
      });
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  // Equipe agrupada por contrato (o roster vem flat da view).
  const rosterByContract = useMemo(() => {
    const map = new Map<string, ContractRosterMember[]>();
    for (const m of roster ?? []) {
      const list = map.get(m.contractId) ?? [];
      list.push(m);
      map.set(m.contractId, list);
    }
    return map;
  }, [roster]);

  if (error) {
    return (
      <div className="rounded-md border px-3 py-6 text-center text-sm text-muted-foreground">
        Não foi possível carregar os contratos.
      </div>
    );
  }

  if (periods === null || roster === null) {
    return (
      <div className="space-y-2">
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-24 w-full" />
      </div>
    );
  }

  if (periods.length === 0) {
    return (
      <div className="rounded-md border px-3 py-8 text-center text-sm text-muted-foreground">
        Sem contrato registrado neste projeto.
      </div>
    );
  }

  return (
    <div className="space-y-2.5">
      {periods.map((p) => {
        const pal = paletteFor(p.seq);
        const team = rosterByContract.get(p.contractId) ?? [];
        const chip = CONTRACT_STATUS[p.status];
        return (
          <div key={p.contractId} className="overflow-hidden rounded-lg border">
            {/* Cabeçalho: identidade + tipo + status + vigência */}
            <div className="flex items-start gap-3 border-b bg-muted/20 px-3 py-2.5">
              <span aria-hidden className={cn("mt-1 size-2.5 shrink-0 rounded-full", pal.dot)} />
              <div className="min-w-0 flex-1">
                <p className="flex items-center gap-2 truncate text-sm font-medium">
                  {p.label}
                  <span className={cn("rounded-sm border px-1 py-px text-[10px] font-normal", pal.border, pal.text)}>
                    {billingLabel(p.billingType)}
                  </span>
                  <StatusChip tone={chip.tone}>{chip.label}</StatusChip>
                </p>
                <p className="mt-0.5 flex items-center gap-1.5 truncate font-mono text-xs tabular-nums text-muted-foreground">
                  <CalendarRange className="size-3 shrink-0" />
                  {fmtDate(p.effectiveFrom)} → {p.effectiveTo ? fmtDate(p.effectiveTo) : "atual"}
                </p>
              </div>
            </div>

            {/* Equipe alocada (sem valores) */}
            <div className="px-3 py-2.5">
              <p className="mb-1.5 flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                <Users className="size-3" /> Equipe
              </p>
              {team.length === 0 ? (
                <p className="text-xs text-muted-foreground">Equipe não definida no contrato.</p>
              ) : (
                <ul className="divide-y divide-border/60">
                  {team.map((m) => (
                    <li key={m.allocationId} className="flex items-center gap-2.5 py-1.5">
                      <span className="truncate text-sm">{m.memberName}</span>
                      <span className="shrink-0 rounded-sm border px-1 py-px text-[10px] text-muted-foreground">
                        {positionLabel(m.memberPosition)}
                      </span>
                      <span className="ml-auto shrink-0 font-mono text-xs tabular-nums text-muted-foreground">
                        {m.percent}%
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        );
      })}

      <p className="flex items-center gap-1.5 px-1 pt-1 text-[10px] text-muted-foreground">
        <FileText className="size-3" /> Somente leitura · valores e edição no app S&OP (admin).
      </p>
    </div>
  );
}
