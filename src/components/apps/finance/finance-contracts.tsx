"use client";

/**
 * Cards de contrato do projeto (READ) — N contratos por projeto, vigência
 * temporal. Clicar escopa o hub àquela vigência; o lápis abre o **sheet rico**
 * (FinanceContractSheet) — superfície única de escrita (RB2 2.6). A criação/
 * edição de termos, cláusulas, equipe e aditivos NÃO vive mais aqui (saiu do
 * canvas). Cada card embute seu cronograma de blocos (sprints da vigência).
 */

import { useState } from "react";
import { FileText, Pencil, Plus, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { ConfirmDialog, type ConfirmState } from "@/components/ui/confirm-dialog";
import { fetchOrThrow, showErrorToast } from "@/lib/optimistic/toast";
import { brlFromCents } from "@/lib/format-currency";
import { fmtDate, fmtDayMonth } from "@/lib/date-utils";
import { cn } from "@/lib/utils";
import { Cronograma } from "@/components/timeline/cronograma";
import type { BillingType, Contract, SprintLite } from "@/lib/finance/types";
import { contractForDate, paletteFor } from "./contract-bands";

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
  contracts,
  sprints,
  selectedContractId,
  onSelectContract,
  onCreateContract,
  onEditContract,
  onChanged,
}: {
  contracts: Contract[];
  sprints: SprintLite[];
  selectedContractId: string | null;
  onSelectContract: (id: string | null) => void;
  onCreateContract: () => void;
  onEditContract: (c: Contract) => void;
  onChanged: () => void;
}) {
  const [confirm, setConfirm] = useState<ConfirmState | null>(null);

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
        <Button size="sm" variant="outline" onClick={onCreateContract}>
          <Plus className="size-3.5" /> Contrato
        </Button>
      </div>

      {contracts.length === 0 ? (
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
                        ? c.totalValueCents != null
                          ? ` · ${brlFromCents(c.totalValueCents)}${c.contractedFp != null ? ` · ${c.contractedFp} FP` : ""}${c.pricePerFpCents != null ? ` · ${brlFromCents(c.pricePerFpCents)}/FP` : ""}`
                          : c.contractedFp != null
                            ? ` · ${c.contractedFp} FP`
                            : ""
                        : c.monthlyFeeCents != null
                          ? ` · ${brlFromCents(c.monthlyFeeCents)}/mês${c.contractedSprints != null ? ` · ${c.contractedSprints} sprints` : ""}`
                          : ""}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    <button
                      type="button"
                      title="Editar contrato"
                      aria-label="Editar contrato"
                      onClick={(e) => {
                        e.stopPropagation();
                        onEditContract(c);
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

                {/* Cronograma de blocos deste contrato — chip unificado, faixa que rola */}
                {covered.length > 0 && (
                  <div className="px-3 pb-2.5">
                    <Cronograma
                      shape="chip"
                      layout="scroll"
                      blocks={covered.map((s) => ({
                        key: s.id,
                        indicator: shortName(s.name),
                        dateLabel: fmtDayMonth(s.startDate),
                        tone: { border: pal.border, band: pal.band, text: pal.text },
                        title: `${s.name} · ${fmtDate(s.startDate)} → ${fmtDate(s.endDate)}`,
                      }))}
                    />
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
