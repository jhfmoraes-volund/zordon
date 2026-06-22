"use client";

/**
 * Cronograma de blocos — as sprints do projeto como blocos de 7 dias, coloridos
 * pelo contrato que rege cada uma (1ª sprint de cada contrato ganha um acento =
 * a troca de contrato). Empilhado (wrap), cap de 5 linhas inline; botão abre um
 * sheet dedicado com o cronograma completo + legenda. Clicar num bloco escopa a
 * DRE ao contrato. A fronteira se edita no editor de contratos.
 */

import { useState } from "react";
import { CalendarRange, Maximize2 } from "lucide-react";

import {
  ResponsiveSheet,
  ResponsiveSheetBody,
  ResponsiveSheetContent,
  ResponsiveSheetHeader,
  ResponsiveSheetTitle,
} from "@/components/ui/responsive-sheet";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { fmtDate } from "@/lib/date-utils";
import type { Contract, SprintLite } from "@/lib/finance/types";
import { contractForDate, NEUTRAL_PALETTE, paletteFor } from "./contract-bands";

const BLOCK_PX = 36; // size-9
const GAP_PX = 6; // gap-1.5
const MAX_ROWS = 5;
const INLINE_MAX_H = MAX_ROWS * BLOCK_PX + (MAX_ROWS - 1) * GAP_PX;

function shortName(name: string): string {
  const m = /^Sprint\s+(.+)$/i.exec(name);
  return m ? m[1] : name;
}

/** Grid de blocos com wrap. `detailed` mostra datas embaixo do número (sheet). */
function SprintGrid({
  sprints,
  contracts,
  selectedContractId,
  onSelectContract,
  detailed,
}: {
  sprints: SprintLite[];
  contracts: Contract[];
  selectedContractId: string | null;
  onSelectContract: (id: string | null) => void;
  detailed?: boolean;
}) {
  const cells = sprints.map((s, i) => {
    const contract = contractForDate(contracts, s.startDate);
    const prev = i > 0 ? contractForDate(contracts, sprints[i - 1].startDate) : null;
    return { s, contract, isBoundary: (contract?.id ?? null) !== (prev?.id ?? null) };
  });
  return (
    <div className="flex flex-wrap gap-1.5">
      {cells.map(({ s, contract, isBoundary }) => {
        const pal = contract ? paletteFor(contract.seq) : NEUTRAL_PALETTE;
        const selected = contract != null && contract.id === selectedContractId;
        const clickable = contract != null;
        return (
          <button
            key={s.id}
            type="button"
            disabled={!clickable}
            onClick={() => contract && onSelectContract(selected ? null : contract.id)}
            title={`${s.name} · ${fmtDate(s.startDate)} → ${fmtDate(s.endDate)}${contract ? ` · ${contract.label}` : ""}`}
            className={cn(
              "flex shrink-0 flex-col items-center justify-center rounded-sm border font-mono tabular-nums",
              detailed ? "h-12 min-w-12 px-1.5 text-xs" : "size-9 text-xs",
              pal.border,
              pal.band,
              clickable && "cursor-pointer hover:brightness-110",
              isBoundary && contract && cn("ring-2 ring-inset", pal.border),
              selected && cn("ring-2 ring-inset", pal.dot.replace("bg-", "ring-")),
            )}
          >
            <span className={cn("font-medium", contract && pal.text)}>{shortName(s.name)}</span>
            {detailed && (
              <span className="text-[9px] font-normal text-muted-foreground">{fmtDate(s.startDate)}</span>
            )}
          </button>
        );
      })}
    </div>
  );
}

export function FinanceSprintTimeline({
  sprints,
  contracts,
  selectedContractId,
  onSelectContract,
}: {
  sprints: SprintLite[];
  contracts: Contract[];
  selectedContractId: string | null;
  onSelectContract: (id: string | null) => void;
}) {
  const [fullOpen, setFullOpen] = useState(false);

  if (sprints.length === 0) {
    return (
      <div className="rounded-md border px-3 py-6 text-center text-sm text-muted-foreground">
        Sem sprints — o cronograma aparece quando o projeto tiver sprints.
      </div>
    );
  }

  return (
    <div className="rounded-md border p-3">
      <div className="mb-2 flex items-center justify-between px-1">
        <p className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
          <CalendarRange className="size-3.5" /> Cronograma de blocos
        </p>
        <Button size="sm" variant="ghost" onClick={() => setFullOpen(true)}>
          <Maximize2 className="size-3.5" /> Completo
        </Button>
      </div>

      {/* Preview: empilhado, cap de 5 linhas (clipa o excesso → sheet completo) */}
      <div style={{ maxHeight: INLINE_MAX_H }} className="overflow-hidden">
        <SprintGrid
          sprints={sprints}
          contracts={contracts}
          selectedContractId={selectedContractId}
          onSelectContract={onSelectContract}
        />
      </div>

      <ResponsiveSheet open={fullOpen} onOpenChange={setFullOpen}>
        <ResponsiveSheetContent size="lg">
          <ResponsiveSheetHeader>
            <ResponsiveSheetTitle>Cronograma de blocos</ResponsiveSheetTitle>
            <p className="font-mono text-[11px] text-muted-foreground">
              {sprints.length} {sprints.length === 1 ? "sprint" : "sprints"} · cor = contrato
            </p>
          </ResponsiveSheetHeader>
          <ResponsiveSheetBody>
            <div className="space-y-4">
              {/* Legenda dos contratos */}
              {contracts.length > 0 && (
                <div className="flex flex-wrap gap-x-4 gap-y-1.5 px-1">
                  {contracts.map((c) => {
                    const pal = paletteFor(c.seq);
                    return (
                      <span key={c.id} className="flex items-center gap-1.5 text-[11px]">
                        <span className={cn("size-2.5 rounded-full", pal.dot)} />
                        <span className="font-medium">{c.label}</span>
                        <span className="text-muted-foreground">
                          {fmtDate(c.effectiveFrom)} → {c.effectiveTo ? fmtDate(c.effectiveTo) : "atual"}
                        </span>
                      </span>
                    );
                  })}
                </div>
              )}
              <SprintGrid
                sprints={sprints}
                contracts={contracts}
                selectedContractId={selectedContractId}
                onSelectContract={(id) => {
                  onSelectContract(id);
                  setFullOpen(false);
                }}
                detailed
              />
            </div>
          </ResponsiveSheetBody>
        </ResponsiveSheetContent>
      </ResponsiveSheet>
    </div>
  );
}
