"use client";

import { useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";

/** Paleta explícita de um bloco (contrato, delivery, …). O fill do passado. */
export type CronogramaTone = { border: string; band: string; text: string };

/**
 * Bloco do cronograma = uma célula da régua (sprint no Planning/Finanças, semana
 * no PM Review). Superset: os campos novos (`indicator`/`value`/`tone`/`state`…)
 * convivem com os legados (`label`/`kind`/`logCount`) durante a migração.
 */
export type CronogramaBlock = {
  /** Identidade estável = alvo do select. Planning: sprintId. PM Review: weekStart. */
  key: string;
  /** Glifo do chip: nº da sprint / idx da semana. */
  indicator?: string;
  /** Data da célula ("14 jun", via `fmtDayMonth`). */
  dateLabel?: string;
  /** Valor secundário: "1 log" / "3 notes" / "85%". */
  value?: string;
  state?: "past" | "current" | "future";
  /** Passado sem atividade → tracejado. */
  silent?: boolean;
  /** Paleta explícita; omitir ⇒ tom de atividade derivado do `state`. */
  tone?: CronogramaTone;
  /** Tooltip; default derivado de label/value/state. */
  title?: string;
  /** Marco ⚑ acima da célula (régua / PM Review). */
  flagged?: boolean;

  // ── legacy aliases (mantidos durante a migração; remover quando todos migrarem) ──
  /** @deprecated use `title`/`indicator`. */
  label?: string | null;
  /** @deprecated use `state`. */
  kind?: "past" | "current" | "future";
  /** @deprecated use `value`/`silent`. */
  logCount?: number;
};

type Shape = "chip" | "ribbon" | "grid";

/** Bloco normalizado (legacy → novo), com defaults resolvidos. */
type NormBlock = {
  key: string;
  indicator?: string;
  dateLabel?: string;
  value?: string;
  state: "past" | "current" | "future";
  silent: boolean;
  tone?: CronogramaTone;
  title: string;
  flagged: boolean;
};

/** Tom de atividade derivado do estado (sem paleta explícita). */
function activityTone(state: NormBlock["state"]): CronogramaTone {
  if (state === "current")
    return { border: "border-primary/50", band: "bg-primary/10", text: "text-primary" };
  if (state === "future")
    return { border: "border-border/60", band: "bg-transparent", text: "text-muted-foreground/70" };
  return {
    border: "border-emerald-500/40",
    band: "bg-emerald-500/10",
    text: "text-emerald-600 dark:text-emerald-400",
  };
}

function legacyTitle(b: CronogramaBlock, state: NormBlock["state"]): string {
  const label = b.label ?? b.indicator ?? "Sem sprint";
  const logs =
    b.logCount != null ? ` · ${b.logCount} log${b.logCount === 1 ? "" : "s"}` : "";
  const when = state === "current" ? " — corrente" : state === "future" ? " — futura" : "";
  return `${label}${when}${logs}`;
}

function normalize(b: CronogramaBlock): NormBlock {
  const state = b.state ?? b.kind ?? "past";
  const silent =
    b.silent ?? (b.logCount != null && b.logCount === 0 && state === "past");
  const value =
    b.value ??
    (b.logCount != null && b.logCount > 0
      ? `${b.logCount} log${b.logCount === 1 ? "" : "s"}`
      : undefined);
  return {
    key: b.key,
    indicator: b.indicator,
    dateLabel: b.dateLabel,
    value,
    state,
    silent,
    tone: b.tone,
    title: b.title ?? legacyTitle(b, state),
    flagged: b.flagged ?? false,
  };
}

/** Fill da BARRA (ribbon/grid): estado manda; `tone` preenche só o passado-ativo. */
function barClass(nb: NormBlock): string {
  if (nb.state === "current") return "bg-primary/40 ring-1 ring-inset ring-primary/70";
  if (nb.state === "future") return "bg-muted/50";
  if (nb.silent) return "border border-dashed border-muted-foreground/30 bg-transparent";
  return nb.tone?.band ?? "bg-emerald-500/70";
}

/** Tom do TEXTO do value (grid/chip): `tone.text` quando explícito, senão atividade. */
function valueTone(nb: NormBlock): string {
  if (nb.tone) return nb.tone.text;
  if (nb.state === "current") return "text-primary";
  if (nb.state === "future") return "text-muted-foreground/70";
  if (nb.silent) return "text-muted-foreground/60";
  return "text-emerald-500";
}

/** Marco ⚑ posicionado acima da célula. */
function Flag() {
  return (
    <span
      title="Marco (PM Review)"
      className="absolute -top-3.5 left-1/2 -translate-x-1/2 text-[9px] leading-none text-muted-foreground"
    >
      ⚑
    </span>
  );
}

/**
 * Cronograma — fileira de blocos no idioma **chip** (indicador + data + valor
 * opcional + tom). Uma casa única, agnóstica de domínio: o que varia (paleta,
 * indicador, valor, seleção) entra por prop. Compartilhado por Finanças,
 * Planning, PM Review, Wiki e a régua do overview (parity-by-prop, não cópia).
 *
 *  • `shape="chip"`   — chip horizontal (default). Finanças/histórico/Wiki.
 *  • `shape="ribbon"` — fileira fina sem texto (rail/régua mini). [alias `variant="mini"`]
 *  • `shape="grid"`   — grade 64px barra+valor+data. [alias `variant="full"`]
 *
 * `onSelect` ausente ⇒ blocos read-only (`<span>`, não `<button>`).
 */
export function Cronograma({
  blocks,
  selectedKey,
  onSelect,
  shape,
  layout = "wrap",
  collapsible,
  size = "md",
  variant,
}: {
  blocks: CronogramaBlock[];
  selectedKey?: string | null;
  onSelect?: (key: string) => void;
  shape?: Shape;
  layout?: "scroll" | "wrap";
  collapsible?: { previewCount: number };
  /** Densidade do `ribbon`: sm (board) / md (rail, default) / lg (tooltip da régua). */
  size?: "sm" | "md" | "lg";
  /** @deprecated use `shape`. mini→ribbon, full→grid. */
  variant?: "mini" | "full";
}) {
  const resolvedShape: Shape =
    shape ?? (variant === "mini" ? "ribbon" : variant === "full" ? "grid" : "chip");

  const [expanded, setExpanded] = useState(false);

  if (blocks.length === 0) return null;

  const norm = blocks.map(normalize);
  const collapsed =
    collapsible != null && !expanded && norm.length > collapsible.previewCount;
  const visible = collapsed ? norm.slice(0, collapsible.previewCount) : norm;
  const hiddenCount = collapsible != null ? norm.length - collapsible.previewCount : 0;

  const interactive = !!onSelect;
  const Cell = interactive ? "button" : "span";
  const hasFlag = visible.some((b) => b.flagged);

  // ── ribbon ── (≡ `mini` legado; `size` reproduz as densidades da régua)
  if (resolvedShape === "ribbon") {
    const pill = size === "sm" ? "h-2 w-3" : size === "lg" ? "h-3 w-5" : "h-2.5 w-3.5";
    return (
      <div
        className={cn(
          "flex items-center",
          size === "lg" ? "gap-1" : "gap-[3px]",
          layout === "scroll" ? "overflow-x-auto" : "flex-wrap",
          hasFlag && "mt-3",
        )}
      >
        {visible.map((nb) => {
          const isSelected = selectedKey === nb.key;
          return (
            <span key={nb.key} className="relative">
              {nb.flagged && <Flag />}
              <Cell
                {...(interactive
                  ? { type: "button" as const, "aria-pressed": isSelected, onClick: () => onSelect!(nb.key) }
                  : {})}
                title={nb.title}
                className={cn(
                  "block rounded-[3px]",
                  pill,
                  interactive && "transition-transform hover:scale-110",
                  barClass(nb),
                  isSelected && "ring-2 ring-primary ring-offset-1 ring-offset-background",
                )}
              />
            </span>
          );
        })}
      </div>
    );
  }

  // ── grid ── (≡ `full` legado: barra + valor + data, indicador opcional)
  if (resolvedShape === "grid") {
    return (
      <div>
        <div
          className={cn(
            "grid grid-cols-[repeat(auto-fill,minmax(64px,1fr))] gap-x-2 gap-y-4",
            hasFlag && "mt-3",
          )}
        >
          {visible.map((nb) => {
            const isSelected = selectedKey === nb.key;
            return (
              <Cell
                key={nb.key}
                {...(interactive
                  ? { type: "button" as const, "aria-pressed": isSelected, onClick: () => onSelect!(nb.key) }
                  : {})}
                title={nb.title}
                className={cn(
                  "group relative block min-w-0 rounded-md p-1 text-left transition-colors",
                  interactive ? "cursor-pointer hover:bg-accent/40" : "cursor-help",
                  isSelected && "bg-primary/10 ring-1 ring-primary/40",
                )}
              >
                {nb.flagged && (
                  <span
                    title="Marco (PM Review)"
                    className="absolute -top-3.5 left-0 text-[9px] leading-none text-muted-foreground"
                  >
                    ⚑
                  </span>
                )}
                {nb.indicator != null && (
                  <div className="mb-1 truncate font-mono text-[11px] font-medium leading-none tabular-nums text-foreground/80">
                    {nb.indicator}
                  </div>
                )}
                <div className={cn("h-2.5 rounded-[3px]", barClass(nb))} />
                <div
                  className={cn(
                    "mt-1.5 h-[11px] truncate text-[11px] font-medium leading-none tabular-nums",
                    valueTone(nb),
                  )}
                >
                  {nb.value ?? ""}
                </div>
                <div className="mt-1 text-[10px] leading-none tabular-nums text-muted-foreground/70">
                  {nb.dateLabel ?? ""}
                </div>
              </Cell>
            );
          })}
        </div>
        {collapsible != null && norm.length > collapsible.previewCount && (
          <CollapseToggle expanded={expanded} hiddenCount={hiddenCount} onToggle={() => setExpanded((v) => !v)} />
        )}
      </div>
    );
  }

  // ── chip ── (idioma alvo)
  return (
    <div>
      <div
        className={cn(
          "flex gap-1.5",
          layout === "scroll"
            ? "overflow-x-auto pb-0.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
            : "flex-wrap",
        )}
      >
        {visible.map((nb) => {
          const isSelected = selectedKey === nb.key;
          const tone = nb.tone ?? activityTone(nb.state);
          return (
            <span key={nb.key} className={cn("relative shrink-0", nb.flagged && "mt-3")}>
              {nb.flagged && <Flag />}
              <Cell
                {...(interactive
                  ? { type: "button" as const, "aria-pressed": isSelected, onClick: () => onSelect!(nb.key) }
                  : {})}
                title={nb.title}
                className={cn(
                  "flex h-[30px] min-w-[58px] items-center gap-1.5 rounded-[7px] border pl-1.5 pr-2.5 font-mono tabular-nums transition-colors",
                  nb.silent
                    ? "border-dashed border-muted-foreground/40 bg-transparent text-muted-foreground"
                    : cn(tone.border, tone.band),
                  nb.state === "future" && !nb.tone && "opacity-70",
                  interactive && "cursor-pointer hover:brightness-110",
                  isSelected && "ring-2 ring-primary ring-offset-1 ring-offset-background",
                )}
              >
                {nb.indicator != null && (
                  <span
                    className={cn(
                      "grid size-[18px] shrink-0 place-items-center rounded-[4px] text-[10px] font-bold",
                      nb.silent
                        ? "border border-dashed border-muted-foreground/40 text-muted-foreground"
                        : cn(tone.band, tone.text),
                    )}
                  >
                    {nb.indicator}
                  </span>
                )}
                {nb.dateLabel && (
                  <span className="text-[11px] font-normal text-muted-foreground">{nb.dateLabel}</span>
                )}
                {nb.value && (
                  <span className={cn("ml-0.5 text-[10px] font-semibold", nb.silent ? "text-muted-foreground" : tone.text)}>
                    {nb.value}
                  </span>
                )}
              </Cell>
            </span>
          );
        })}
      </div>
      {collapsible != null && norm.length > collapsible.previewCount && (
        <CollapseToggle expanded={expanded} hiddenCount={hiddenCount} onToggle={() => setExpanded((v) => !v)} />
      )}
    </div>
  );
}

function CollapseToggle({
  expanded,
  hiddenCount,
  onToggle,
}: {
  expanded: boolean;
  hiddenCount: number;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      className="mt-2 text-xs text-muted-foreground transition-colors hover:text-foreground"
    >
      {expanded ? "⌃ Ver menos" : `⌄ Ver mais (${hiddenCount})`}
    </button>
  );
}

/** Escala de delivery → tom explícito (≥85 emerald · ≥50 amarelo · <50 vermelho · null muted).
 *  Agnóstico de domínio (só pct→tom): o caller (régua) calcula e passa via `tone`. */
export function deliveryTone(pct: number | null): CronogramaTone {
  if (pct === null)
    return { band: "bg-muted-foreground/40", text: "text-muted-foreground", border: "border-border/60" };
  if (pct >= 85)
    return { band: "bg-emerald-500/70", text: "text-emerald-500", border: "border-emerald-500/40" };
  if (pct >= 50)
    return { band: "bg-yellow-500/60", text: "text-yellow-500", border: "border-yellow-500/40" };
  return { band: "bg-red-400/70", text: "text-red-400", border: "border-red-400/40" };
}

/**
 * Régua-strip no topo da página: faixa com borda inferior, `label` curto à
 * esquerda, o `Cronograma` (ribbon) na sequência e uma `action` opcional à
 * direita. Casca reutilizada por Planning ("Histórico") e PM Review ("Semanas").
 * Retorna `null` quando não há blocos.
 */
export function CronogramaRail({
  label,
  blocks,
  selectedKey,
  onSelect,
  action,
}: {
  label: string;
  blocks: CronogramaBlock[];
  selectedKey: string | null;
  onSelect: (key: string) => void;
  action?: ReactNode;
}) {
  if (blocks.length === 0) return null;
  return (
    <div className="flex shrink-0 items-center gap-3 border-b bg-background px-6 py-2">
      <span className="shrink-0 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
        {label}
      </span>
      <Cronograma shape="ribbon" blocks={blocks} selectedKey={selectedKey} onSelect={onSelect} />
      {action && <div className="ml-auto">{action}</div>}
    </div>
  );
}
