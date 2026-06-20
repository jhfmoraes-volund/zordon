"use client";

import { cn } from "@/lib/utils";

/** Bloco do cronograma = uma célula da régua (sprint no Planning, semana no PM Review). */
export type CronogramaBlock = {
  /**
   * Identidade estável da célula = alvo do select. Planning: sprintId.
   * PM Review: weekStart (YYYY-MM-DD). None/órfã: "__none__".
   */
  key: string;
  /** Data da célula (dd/mm) — eixo da régua. */
  dateLabel: string;
  /** Rótulo/tooltip da célula (nome da sprint, ou null). */
  label: string | null;
  kind: "past" | "current" | "future";
  /** Nº de itens na janela (versões no Planning, notes no PM Review). */
  logCount: number;
};

/** Cor da barra do bloco — semântica de atividade, não de delivery. */
function barClass(b: CronogramaBlock): string {
  if (b.kind === "current") return "bg-primary/40 ring-1 ring-inset ring-primary/70";
  if (b.kind === "future") return "bg-muted/50";
  // past: aceso (teve atividade) vs tracejado (sem atividade).
  return b.logCount > 0
    ? "bg-emerald-500/70"
    : "border border-dashed border-muted-foreground/30 bg-transparent";
}

/** Tom do texto do value label (só no variant full) — ecoa a cor da barra. */
function valueTone(b: CronogramaBlock): string {
  if (b.kind === "current") return "text-primary";
  if (b.kind === "future") return "text-muted-foreground/70";
  return b.logCount > 0 ? "text-emerald-500" : "text-muted-foreground/60";
}

function blockTitle(b: CronogramaBlock): string {
  const label = b.label ?? "Sem sprint";
  const logs = `${b.logCount} log${b.logCount === 1 ? "" : "s"}`;
  const when =
    b.kind === "current" ? " — corrente" : b.kind === "future" ? " — futura" : "";
  return `${label}${when} · ${logs}`;
}

/**
 * Cronograma de blocos — réplica do estilo da régua/timeline (uma célula por
 * sprint/semana). Cor da barra = atividade. Clicar num bloco navega pra aquela
 * janela. **Compartilhado** entre Planning (régua de sprint) e PM Review (grade
 * semanal): a identidade da célula vem em `block.key` (parity via prop, não cópia).
 *
 *  • `mini`  — fileira fina (sem datas/labels) pro ribbon: glance + entrada.
 *  • `full`  — grid com data + nº de itens (vive no side-sheet, week-picker).
 */
export function PlanningCronograma({
  blocks,
  selectedKey,
  onSelect,
  variant = "full",
}: {
  blocks: CronogramaBlock[];
  /** Key do bloco selecionado; null = nenhum. */
  selectedKey: string | null;
  onSelect: (key: string) => void;
  variant?: "mini" | "full";
}) {
  if (blocks.length === 0) return null;

  if (variant === "mini") {
    return (
      <div className="flex flex-wrap items-center gap-[3px]">
        {blocks.map((b) => {
          const isSelected = selectedKey === b.key;
          return (
            <button
              key={b.key}
              type="button"
              title={blockTitle(b)}
              aria-pressed={isSelected}
              onClick={() => onSelect(b.key)}
              className={cn(
                "h-2.5 w-3.5 rounded-[3px] transition-transform hover:scale-110",
                barClass(b),
                isSelected && "ring-2 ring-primary ring-offset-1 ring-offset-background",
              )}
            />
          );
        })}
      </div>
    );
  }

  return (
    <div className="grid grid-cols-[repeat(auto-fill,minmax(64px,1fr))] gap-x-2 gap-y-4">
      {blocks.map((b) => {
        const isSelected = selectedKey === b.key;
        return (
          <button
            key={b.key}
            type="button"
            title={blockTitle(b)}
            aria-pressed={isSelected}
            onClick={() => onSelect(b.key)}
            className={cn(
              "group min-w-0 cursor-pointer rounded-md p-1 text-left transition-colors hover:bg-accent/40",
              isSelected && "bg-primary/10 ring-1 ring-primary/40",
            )}
          >
            <div className={cn("h-2.5 rounded-[3px]", barClass(b))} />
            <div
              className={cn(
                "mt-1.5 h-[11px] truncate text-[11px] font-medium leading-none tabular-nums",
                valueTone(b),
              )}
            >
              {b.logCount > 0 ? `${b.logCount} log${b.logCount === 1 ? "" : "s"}` : ""}
            </div>
            <div className="mt-1 text-[10px] leading-none tabular-nums text-muted-foreground/70">
              {b.dateLabel}
            </div>
          </button>
        );
      })}
    </div>
  );
}
