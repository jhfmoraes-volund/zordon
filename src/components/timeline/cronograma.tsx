"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";

/**
 * Paleta explícita de um bloco (contrato, delivery, …). O fill do passado.
 * `band` = fundo leve do chip (.10); `bar` = fill forte da barra ribbon/grid
 * (.60–.70). Omitir `bar` ⇒ barra cai em `band` (ok p/ quem só usa chip).
 */
export type CronogramaTone = { border: string; band: string; text: string; bar?: string };

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
  return nb.tone?.bar ?? nb.tone?.band ?? "bg-emerald-500/70";
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

  // Régua que rola (layout="scroll"): centraliza o bloco selecionado quando a
  // seleção muda — em contrato longo o corrente cai fora da viewport. (espelha
  // o auto-scroll do DSRibbon).
  const selectedChipRef = useRef<HTMLSpanElement | null>(null);
  useEffect(() => {
    if (layout !== "scroll" || !selectedKey) return;
    selectedChipRef.current?.scrollIntoView({ behavior: "smooth", inline: "center", block: "nearest" });
  }, [layout, selectedKey]);

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
                  isSelected && "ring-1 ring-primary",
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
          // `tone` explícito (Finanças/delivery) ⇒ cor é o sinal, renderiza colorido.
          // Sem tone (modo atividade: PM Review/semanas) ⇒ chips UNIFORMES; o único
          // sinal é um dot verde quando a célula tem atividade (`!silent`). Seleção =
          // underline de acento (sem halo neon).
          const explicit = !!nb.tone;
          const tone = nb.tone ?? activityTone(nb.state);
          const activeDot = !explicit && !nb.silent;
          return (
            <span
              key={nb.key}
              ref={isSelected ? selectedChipRef : undefined}
              className={cn("relative shrink-0", nb.flagged && "mt-3")}
            >
              {nb.flagged && <Flag />}
              <Cell
                {...(interactive
                  ? { type: "button" as const, "aria-pressed": isSelected, onClick: () => onSelect!(nb.key) }
                  : {})}
                title={nb.title}
                className={cn(
                  "relative flex h-[30px] min-w-[58px] items-center gap-1.5 rounded-[7px] border pl-1.5 pr-2.5 font-mono tabular-nums transition-colors",
                  explicit ? cn(tone.border, tone.band) : "border-border bg-transparent",
                  isSelected && (explicit ? "bg-foreground/[0.04]" : "bg-foreground/[0.06]"),
                  interactive && "cursor-pointer hover:bg-foreground/[0.05]",
                )}
              >
                {activeDot && (
                  <span aria-hidden className="size-1.5 shrink-0 rounded-full bg-emerald-500" />
                )}
                {nb.indicator != null && (
                  <span
                    className={cn(
                      "grid size-[18px] shrink-0 place-items-center rounded-[4px] text-[10px] font-bold",
                      explicit ? cn(tone.band, tone.text) : "text-foreground/80",
                    )}
                  >
                    {nb.indicator}
                  </span>
                )}
                {nb.dateLabel && (
                  <span className="text-[11px] font-normal text-muted-foreground">{nb.dateLabel}</span>
                )}
                {nb.value && (
                  <span className={cn("ml-0.5 text-[10px] font-semibold", explicit ? tone.text : "text-muted-foreground")}>
                    {nb.value}
                  </span>
                )}
                {isSelected && (
                  <span
                    aria-hidden
                    className="pointer-events-none absolute inset-x-2 bottom-[3px] h-[2px] rounded-full bg-primary"
                  />
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
    return { band: "bg-muted-foreground/10", bar: "bg-muted-foreground/40", text: "text-muted-foreground", border: "border-border/60" };
  if (pct >= 85)
    return { band: "bg-emerald-500/10", bar: "bg-emerald-500/70", text: "text-emerald-500", border: "border-emerald-500/40" };
  if (pct >= 50)
    return { band: "bg-yellow-500/10", bar: "bg-yellow-500/60", text: "text-yellow-500", border: "border-yellow-500/40" };
  return { band: "bg-red-400/10", bar: "bg-red-400/70", text: "text-red-400", border: "border-red-400/40" };
}

/** Cor do pontinho de status no dropdown mobile da régua (idioma de atividade). */
function railDotClass(nb: NormBlock): string {
  if (nb.state === "current") return "bg-primary ring-2 ring-primary/30";
  if (nb.silent) return "border border-dashed border-muted-foreground/40 bg-transparent";
  if (nb.state === "future") return "bg-muted-foreground/30";
  return nb.tone?.bar ?? "bg-emerald-500"; // passado com atividade
}

/**
 * Régua-strip no topo da página: `label` curto à esquerda, o cronograma e uma
 * `action` opcional à direita. Casca reutilizada por Planning ("Histórico") e
 * PM Review ("Semanas").
 *
 * Desktop (≥md): o `Cronograma` em **chip** com scroll lateral — centraliza o
 * bloco selecionado conforme navega. Mobile (<md): vira um **dropdown**
 * (a fileira de chips não cabe num telefone) — mesmo padrão do `DSRibbon`.
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
      {/* Mobile (<md): dropdown — a fileira de chips não cabe num telefone. */}
      <div className="min-w-0 flex-1 md:hidden">
        <CronogramaRailSelect
          label={label}
          blocks={blocks}
          selectedKey={selectedKey}
          onSelect={onSelect}
        />
      </div>
      {/* Desktop (≥md): chips com scroll lateral. */}
      <div className="hidden min-w-0 flex-1 md:block">
        <Cronograma shape="chip" layout="scroll" blocks={blocks} selectedKey={selectedKey} onSelect={onSelect} />
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}

/**
 * Picker mobile da régua — trigger mostra o bloco selecionado (●  indicador ·
 * data · valor); tocar abre a lista completa. Espelha o `DSStepSelect`.
 */
function CronogramaRailSelect({
  label,
  blocks,
  selectedKey,
  onSelect,
}: {
  label: string;
  blocks: CronogramaBlock[];
  selectedKey: string | null;
  onSelect: (key: string) => void;
}) {
  const norm = blocks.map(normalize);
  const selected = norm.find((b) => b.key === selectedKey) ?? null;
  return (
    <Select
      value={selectedKey ?? undefined}
      onValueChange={(value) => {
        if (value != null) onSelect(value);
      }}
    >
      <SelectTrigger size="sm" aria-label={label} className="w-full justify-between">
        <SelectValue placeholder={label}>
          {selected ? <RailOption nb={selected} /> : label}
        </SelectValue>
      </SelectTrigger>
      <SelectContent>
        {norm.map((nb) => (
          <SelectItem key={nb.key} value={nb.key}>
            <RailOption nb={nb} />
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function RailOption({ nb }: { nb: NormBlock }) {
  return (
    <span className="flex min-w-0 items-center gap-1.5 font-mono tabular-nums">
      <span aria-hidden className={cn("size-2 shrink-0 rounded-full", railDotClass(nb))} />
      {nb.indicator != null && <span className="shrink-0 font-medium">{nb.indicator}</span>}
      {nb.dateLabel && <span className="truncate text-muted-foreground">· {nb.dateLabel}</span>}
      {nb.value && <span className="ml-1 shrink-0 text-[10px] text-muted-foreground">{nb.value}</span>}
    </span>
  );
}
