"use client";

/**
 * Cards de contrato do projeto (READ) — N contratos por projeto, vigência
 * temporal. Clicar escopa o hub àquela vigência; o lápis abre o **sheet rico**
 * (FinanceContractSheet) — superfície única de escrita (RB2 2.6). A criação/
 * edição de termos, cláusulas, equipe e aditivos NÃO vive mais aqui (saiu do
 * canvas). Cada card embute seu cronograma de blocos (sprints da vigência).
 */

import { useState } from "react";
import { CalendarRange, FileText, Pencil, Plus, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { ConfirmDialog, type ConfirmState } from "@/components/ui/confirm-dialog";
import { fetchOrThrow, showErrorToast } from "@/lib/optimistic/toast";
import { brlFromCents } from "@/lib/format-currency";
import { fmtDate } from "@/lib/date-utils";
import { cn } from "@/lib/utils";
import type { BillingType, Contract, SprintLite } from "@/lib/finance/types";
import { contractForDate, paletteFor } from "./contract-bands";

function billingLabel(b: BillingType): string {
  return b === "fixed_scope" ? "Encomenda" : "Squad";
}
/** Sprints cobertas por este contrato (membership pela data de início da sprint). */
function coveredSprints(contract: Contract, contracts: Contract[], sprints: SprintLite[]): SprintLite[] {
  return sprints.filter((s) => contractForDate(contracts, s.startDate)?.id === contract.id);
}

export function FinanceContracts({
  contracts,
  sprints,
  category,
  selectedContractId,
  onSelectContract,
  onCreateContract,
  onEditContract,
  onChanged,
}: {
  contracts: Contract[];
  sprints: SprintLite[];
  /** Categoria do projeto — modula o empty-state (interno não precisa de contrato). */
  category?: string;
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
          <FileText className="size-3.5" /> Contratos deste projeto
        </p>
        <Button size="sm" variant="outline" onClick={onCreateContract}>
          <Plus className="size-3.5" /> Contrato
        </Button>
      </div>

      {contracts.length === 0 ? (
        <div className="rounded-md border px-3 py-6 text-center text-sm text-muted-foreground">
          {category === "internal"
            ? "Projeto interno — não precisa de contrato."
            : "Sem contrato — defina um pra registrar preço/condições por período (use + Contrato)."}
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

                {/* Chip de contagem — clicar o contrato já escopa o Cronograma 3-grid
                    àquelas sprints; aqui só o tamanho (sem faixa que rola dentro do card). */}
                {covered.length > 0 && (
                  <div className="px-3 pb-2.5">
                    <span className="inline-flex items-center gap-1 rounded-md border px-2 py-1 font-mono text-[11px] tabular-nums text-muted-foreground">
                      <CalendarRange className="size-3" />
                      {covered.length} {covered.length === 1 ? "sprint" : "sprints"}
                    </span>
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
