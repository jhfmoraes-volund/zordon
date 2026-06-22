/**
 * Helpers compartilhados entre o editor de contratos e o cronograma de blocos:
 * paleta estável por contrato (seq) e resolução "qual contrato cobre esta data".
 */
import type { Contract } from "@/lib/finance/types";

export type ContractPalette = {
  dot: string;
  band: string;
  border: string;
  text: string;
};

const CONTRACT_PALETTE: ContractPalette[] = [
  { dot: "bg-sky-500", band: "bg-sky-500/10", border: "border-sky-500/40", text: "text-sky-600 dark:text-sky-400" },
  { dot: "bg-violet-500", band: "bg-violet-500/10", border: "border-violet-500/40", text: "text-violet-600 dark:text-violet-400" },
  { dot: "bg-amber-500", band: "bg-amber-500/10", border: "border-amber-500/40", text: "text-amber-600 dark:text-amber-400" },
  { dot: "bg-emerald-500", band: "bg-emerald-500/10", border: "border-emerald-500/40", text: "text-emerald-600 dark:text-emerald-400" },
  { dot: "bg-rose-500", band: "bg-rose-500/10", border: "border-rose-500/40", text: "text-rose-600 dark:text-rose-400" },
];

/** Cor estável por contrato — indexada pelo seq (1-based). */
export function paletteFor(seq: number): ContractPalette {
  return CONTRACT_PALETTE[(Math.max(seq, 1) - 1) % CONTRACT_PALETTE.length];
}

/** Banda neutra pra sprints sem contrato cobrindo. */
export const NEUTRAL_PALETTE: ContractPalette = {
  dot: "bg-muted-foreground/40",
  band: "bg-muted/30",
  border: "border-border/60",
  text: "text-muted-foreground",
};

/** Contrato cuja vigência contém a data (YYYY-MM-DD): o de início mais recente que começa até a data. */
export function contractForDate(contracts: Contract[], dateISO: string): Contract | null {
  const day = dateISO.slice(0, 10);
  const covering = contracts
    .filter((c) => c.effectiveFrom.slice(0, 10) <= day && (c.effectiveTo === null || c.effectiveTo.slice(0, 10) >= day))
    .sort((a, b) => b.effectiveFrom.localeCompare(a.effectiveFrom));
  return covering[0] ?? null;
}
