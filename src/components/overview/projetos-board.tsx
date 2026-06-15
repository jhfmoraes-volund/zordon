"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import {
  AlertTriangle,
  ArrowUpRight,
  Briefcase,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Compass,
  Flag,
  FolderKanban,
  Hammer,
  Info,
  KanbanSquare,
  List,
  Pencil,
  SlidersHorizontal,
} from "lucide-react";
import { BoardColumn } from "@/components/design-session/board/board-column";
import type { Accent } from "@/components/design-session/board/tokens";
import {
  ResponsiveSheet,
  ResponsiveSheetContent,
  ResponsiveSheetHeader,
  ResponsiveSheetTitle,
  ResponsiveSheetBody,
  useResponsiveSheetExpanded,
} from "@/components/ui/responsive-sheet";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuCheckboxItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { StatusChip } from "@/components/ui/status-chip";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  lookupChip,
  PROJECT_PHASE,
  PROJECT_ENGAGEMENT,
  type ChipTone,
} from "@/lib/status-chips";
import { fmtDate } from "@/lib/date-utils";
import { cn } from "@/lib/utils";
import { createClient } from "@/lib/supabase/client";
import { showErrorToast } from "@/lib/optimistic/toast";
import {
  ProjectEditSheet,
  type ProjectEditInitial,
} from "@/components/projects/project-edit-sheet";
import type {
  ProjectOverview,
  ProjectPhase,
  ProjectHealth,
  ProjectStats,
  ProjectTeamMember,
  PMReviewNoteLite,
  ReguaSegment,
} from "@/lib/dal/project-overview";
import type { MetricValue, Threshold } from "@/lib/metrics/types";

/**
 * Vocabulário do registry de métricas resolvido no server (projetos-view) —
 * só strings/JSON cruzam a fronteira; o registry (compute) nunca entra no
 * bundle client. D1/D6: label e tooltip nascem do mesmo lugar que o Alpha lê.
 */
export type RegistryUi = {
  /** id do registry → name (label da UI). */
  names: Record<string, string>;
  /** id do registry → defense (tooltip D6). */
  defenses: Record<string, string>;
  /** id do registry → thresholds (badges derivam label/tom daqui). */
  bands: Record<string, Threshold[]>;
};

// ─── Vocabulary ───────────────────────────────────────────

/** Seções do board seguem a fase do projeto (funil), não a categoria. */
const PHASE_ORDER: ProjectPhase[] = ["commercial", "immersion", "ops", "post_ops"];

/** Fases em que a produção (sprints) deveria existir. */
const PRODUCING_PHASES: ProjectPhase[] = ["immersion", "ops"];

const HEALTH_DOT: Record<ProjectHealth, string> = {
  red: "bg-red-500",
  amber: "bg-yellow-500",
  green: "bg-green-500",
};

/** Accent das colunas do kanban — ecoa o tone do chip de fase (PROJECT_PHASE). */
const PHASE_ACCENT: Record<ProjectPhase, Accent> = {
  commercial: "violet",
  immersion: "sky",
  ops: "indigo",
  post_ops: "emerald",
};

const PHASE_ICON: Record<ProjectPhase, typeof Briefcase> = {
  commercial: Briefcase,
  immersion: Compass,
  ops: Hammer,
  post_ops: Flag,
};

/** Layout do board: seções por fase (lista) ou colunas por fase (kanban). */
type BoardView = "rows" | "kanban";

const VIEW_STORAGE_KEY = "overview:projetos:view";

function readStoredView(): BoardView {
  if (typeof window === "undefined") return "rows";
  try {
    const stored = window.localStorage.getItem(VIEW_STORAGE_KEY);
    if (stored === "kanban" || stored === "rows") return stored;
  } catch {
    // localStorage bloqueado — cai no default por viewport.
  }
  // Sem preferência salva: desktop nasce no kanban; mobile na lista (colunas
  // empilhadas rendem menos que as seções). Breakpoint espelha useIsMobile.
  return window.matchMedia("(min-width: 768px)").matches ? "kanban" : "rows";
}

const HEALTH_RANK: Record<ProjectHealth, number> = { red: 0, amber: 1, green: 2 };

/** Tom do registry → classe de texto (labels/faixas vêm de RegistryUi.bands). */
const TONE_CLS: Record<Threshold["tone"], string> = {
  green: "text-emerald-500",
  amber: "text-yellow-500",
  red: "text-red-400",
  critical: "text-red-400",
};

/** 1ª faixa (ordem decrescente de gte) onde o valor cai; gte null = catch-all. */
function bandOf(value: number, bands: Threshold[]): Threshold | null {
  return bands.find((b) => b.gte === null || value >= b.gte) ?? null;
}

// Digest do PM Review — 4 slots fixos (Panorama, Riscos, Próximos, Decisões).
// Demais kinds (team_signal etc.) vivem só na review completa.
const KIND_META: Record<string, { label: string; dot: string }> = {
  risk: { label: "Risco", dot: "bg-red-500" },
  need: { label: "Precisa", dot: "bg-yellow-500" },
  open_decision: { label: "Decisão", dot: "bg-yellow-500" },
  next_step: { label: "Próximo", dot: "bg-green-500" },
};

/** Cap de notes visíveis por slot — excedente vira "+N". */
const DIGEST_MAX = 3;

// ─── Helpers ──────────────────────────────────────────────

/** Sinais como chips ("3 riscos", "2 paradas") — drawer e painel de atenção. */
function signalChips(p: ProjectOverview): Array<{ label: string; tone: ChipTone }> {
  const chips: Array<{ label: string; tone: ChipTone }> = [];
  const { overdue, blocked, unassigned } = p.signals;
  // Risco pesa pelo stance, não pela existência — mesma regra do health (DAL).
  const risks = (p.pmReview?.notesByKind.risk ?? []).filter((n) => n.stance !== "managed").length;
  if (overdue > 0) chips.push({ label: `${overdue} vencida${overdue > 1 ? "s" : ""}`, tone: "red" });
  if (risks > 0) chips.push({ label: `${risks} risco${risks > 1 ? "s" : ""}`, tone: "red" });
  if (blocked > 0) chips.push({ label: `${blocked} parada${blocked > 1 ? "s" : ""}`, tone: "amber" });
  if (unassigned > 0) chips.push({ label: `${unassigned} sem dono`, tone: "amber" });
  return chips;
}

/**
 * Motivo único do card — por que o dot não está verde. O card responde só
 * "preciso olhar?" e "onde estamos no contrato?"; contagens extras vivem no
 * drawer. "Sem dono" é higiene de backlog, não sinal de board.
 */
function cardMotivo(p: ProjectOverview): { label: string; tone: ChipTone } | null {
  return signalChips(p).find((c) => !c.label.endsWith("sem dono")) ?? null;
}

/** Dias até uma data YYYY-MM-DD (negativo = venceu), no fuso local. */
function daysUntil(dueAt: string): number {
  const due = new Date(`${dueAt}T00:00:00`);
  return Math.ceil((due.getTime() - Date.now()) / 86400000);
}

/** Chip do próximo marco — só quando perto (vencido=red, ≤14d=amber); longe é ruído de board. */
function milestoneChip(p: ProjectOverview): { label: string; tone: ChipTone } | null {
  if (!p.milestone) return null;
  const days = daysUntil(p.milestone.dueAt);
  if (days > 14) return null;
  const tone: ChipTone = days < 0 ? "red" : "amber";
  return { label: `${p.milestone.label} · ${fmtDate(new Date(`${p.milestone.dueAt}T00:00:00`))}`, tone };
}

/** "Contínuo" ou "Fim ~ DD/MM" — leitura de horizonte do projeto. */
function horizonLabel(p: ProjectOverview): string {
  if (p.engagementType === "continuous") return "Contínuo";
  return p.endDate ? `Fim ~ ${fmtDate(new Date(p.endDate))}` : "Sem prazo definido";
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/);
  return ((parts[0]?.[0] ?? "") + (parts.length > 1 ? parts[parts.length - 1][0] : "")).toUpperCase();
}

/** Stack compacto de iniciais do time, com overflow +N. */
function TeamStack({ team, max = 4 }: { team: ProjectTeamMember[]; max?: number }) {
  if (team.length === 0) return null;
  const shown = team.slice(0, max);
  const overflow = team.length - shown.length;
  return (
    <div className="flex items-center -space-x-1.5">
      {shown.map((m) => (
        <span
          key={m.id}
          title={m.name}
          className="flex h-5 w-5 items-center justify-center rounded-full border border-background bg-muted text-[9px] font-medium text-muted-foreground"
        >
          {initials(m.name)}
        </span>
      ))}
      {overflow > 0 && (
        <span className="flex h-5 w-5 items-center justify-center rounded-full border border-background bg-muted text-[9px] font-medium text-muted-foreground">
          +{overflow}
        </span>
      )}
    </div>
  );
}

/** Média de uma lista ignorando nulls; null se vazia. */
function meanOf(values: Array<number | null>): number | null {
  const nums = values.filter((v): v is number => v !== null);
  if (nums.length === 0) return null;
  return Math.round((nums.reduce((s, v) => s + v, 0) / nums.length) * 10) / 10;
}

function fmtAvg(v: number | null): string {
  return v === null ? "—" : `${v.toLocaleString("pt-BR")} FP/sp`;
}

// ─── Régua ────────────────────────────────────────────────

/** Cor do segmento fechado pela entrega da sprint (sem FP = cinza neutro). */
function segmentColor(deliveryPct: number | null): string {
  if (deliveryPct === null) return "bg-muted-foreground/40";
  if (deliveryPct >= 85) return "bg-emerald-500/70";
  if (deliveryPct >= 50) return "bg-yellow-500/60";
  return "bg-red-400/70";
}

function segmentTitle(g: ProjectStats["segments"][number]): string {
  const sprint = `Sprint de ${fmtDate(new Date(`${g.monday}T00:00:00Z`))}`;
  if (g.kind === "hole") return `${sprint} — desligada: contrato queimou sem produção`;
  if (g.kind === "current")
    return g.sprintId ? `${sprint} — corrente` : `${sprint} — corrente, sem sprint ativa`;
  if (g.kind === "future") return `${sprint} — futura`;
  return g.deliveryPct === null
    ? `${sprint} — fechada (sem FP)`
    : `${sprint} — entregue ${g.deliveryPct}% do planejado`;
}

/**
 * Estado visual da célula — semana é unidade atômica: produziu / desligada /
 * corrente / futura. Corrente é SEMPRE o bloco primary (vermelho) — marcador
 * "estamos aqui" uniforme em todas as linhas; ter ou não sprint ativa fica no
 * tooltip (segmentTitle), não na cor.
 */
function cellClass(g: ProjectStats["segments"][number]): string {
  if (g.kind === "closed") return segmentColor(g.deliveryPct);
  if (g.kind === "hole") return "border border-dashed border-muted-foreground/30 bg-transparent";
  if (g.kind === "current") return "bg-primary/30 ring-1 ring-inset ring-primary/70";
  return "bg-muted/50"; // future
}

/**
 * A régua: uma CÉLULA ATÔMICA por sprint do contrato (ou por sprint, em
 * rolling) — largura fixa, alinhada à esquerda; contrato longo quebra linha.
 * Célula acesa = produção real (cor = entrega); apagada tracejada = sprint do
 * contrato desligada (sem produção). Pista não-cromática: texto "5/12" sempre
 * ao lado + tooltip por célula. Breakdown por status: ReguaSummary (drawer).
 */
function Regua({
  stats,
  size = "sm",
  legend = true,
}: {
  stats: ProjectStats;
  size?: "sm" | "lg";
  /** Título nativo de legenda no container. Off quando a régua já vive dentro de um tooltip. */
  legend?: boolean;
}) {
  if (stats.segments.length === 0) return null;
  const lg = size === "lg";
  // ⚑ só no drawer: na linha do board ele variaria a altura entre rows
  // (jitter de ritmo vertical) e o chip do marco já vive na própria linha.
  const milestoneIdx = lg ? stats.milestoneIndex : null;
  return (
    <div
      title={legend ? "1 bloco = 1 sprint do contrato · cor = entrega real" : undefined}
      className={cn(
        "flex flex-wrap items-center",
        lg ? "gap-1" : "gap-[3px]",
        milestoneIdx !== null && "mt-3",
      )}
    >
      {stats.segments.map((g, i) => (
        <span
          key={g.monday}
          title={segmentTitle(g)}
          className={cn("relative rounded-[3px]", lg ? "h-3 w-5" : "h-2 w-3", cellClass(g))}
        >
          {milestoneIdx === i && (
            <span
              title="Marco (PM Review)"
              className="absolute -top-3.5 left-1/2 -translate-x-1/2 text-[9px] leading-none text-muted-foreground"
            >
              ⚑
            </span>
          )}
        </span>
      ))}
    </div>
  );
}

/**
 * Resumo da régua — breakdown por status, agora servido como TOOLTIP da régua
 * (em vez de frase inline, que poluía o drawer). Conta os blocos por status e
 * mostra só as categorias presentes; o número herda a cor do status (ecoa a
 * régua). A cor/semântica de cada bloco continua no tooltip por célula
 * (segmentTitle). "sprint X/Y" não entra aqui — já vive no StatCol "Contrato".
 */
function reguaSummaryParts(stats: ProjectStats) {
  const c = { entregue: 0, parcial: 0, baixa: 0, desligada: 0, corrente: 0, futura: 0 };
  for (const g of stats.segments) {
    if (g.kind === "hole") c.desligada++;
    else if (g.kind === "current") c.corrente++;
    else if (g.kind === "future") c.futura++;
    else if (g.deliveryPct === null || g.deliveryPct >= 85) c.entregue++;
    else if (g.deliveryPct >= 50) c.parcial++;
    else c.baixa++;
  }
  return [
    { one: "entregue", many: "entregues", n: c.entregue, tone: "text-emerald-500" },
    { one: "parcial", many: "parciais", n: c.parcial, tone: "text-yellow-500" },
    { one: "baixa", many: "baixas", n: c.baixa, tone: "text-red-400" },
    { one: "desligada", many: "desligadas", n: c.desligada, tone: "text-yellow-500" },
    { one: "corrente", many: "correntes", n: c.corrente, tone: "text-primary" },
    { one: "futura", many: "futuras", n: c.futura, tone: undefined },
  ].filter((p) => p.n > 0);
}

/** Linha do breakdown ("3 entregues · 1 parcial · …") — tooltip e legenda da timeline. */
function ReguaSummaryLine({ stats }: { stats: ProjectStats }) {
  const parts = reguaSummaryParts(stats);
  if (parts.length === 0) return null;
  return (
    <div className="flex flex-wrap items-center tabular-nums">
      {parts.map((p, i) => (
        <span key={p.one}>
          {i > 0 && <span className="mx-1.5 opacity-40">·</span>}
          <span className={cn("font-medium", p.tone)}>{p.n}</span> {p.n === 1 ? p.one : p.many}
        </span>
      ))}
    </div>
  );
}

function ReguaSummaryTip({ stats }: { stats: ProjectStats }) {
  return (
    <div className="space-y-1.5">
      <div className="text-muted-foreground">1 bloco = 1 sprint do contrato · cor = entrega real</div>
      <ReguaSummaryLine stats={stats} />
    </div>
  );
}

/** Texto da célula na timeline expandida — entrega em %, estados em palavra. */
function segmentValueLabel(g: ReguaSegment): string {
  if (g.kind === "closed") return g.deliveryPct === null ? "sem FP" : `${g.deliveryPct}%`;
  if (g.kind === "hole") return "desligada";
  if (g.kind === "current") return g.sprintId ? "corrente" : "sem sprint";
  return ""; // futura — a data abaixo já diz tudo
}

/** Tom do texto da célula — ecoa segmentColor (mesmos cortes 85/50). */
function segmentValueTone(g: ReguaSegment): string {
  if (g.kind === "closed") {
    if (g.deliveryPct === null) return "text-muted-foreground";
    if (g.deliveryPct >= 85) return "text-emerald-500";
    if (g.deliveryPct >= 50) return "text-yellow-500";
    return "text-red-400";
  }
  if (g.kind === "hole") return "text-yellow-500/80";
  if (g.kind === "current") return g.sprintId ? "text-primary" : "text-yellow-500";
  return "text-muted-foreground";
}

/**
 * Timeline expandida da régua (sheet em tela cheia): mesma semântica e cores
 * da Regua, com uma coluna por sprint — barra + entrega + segunda da semana.
 * O breakdown que no modo compacto vive em tooltip vira legenda inline; o
 * tooltip por célula (segmentTitle) continua valendo.
 */
function SprintTimeline({ stats }: { stats: ProjectStats }) {
  if (stats.segments.length === 0) return null;
  return (
    <div>
      <div
        className={cn(
          "grid grid-cols-[repeat(auto-fill,minmax(64px,1fr))] gap-x-2 gap-y-5",
          stats.milestoneIndex !== null && "mt-3",
        )}
      >
        {stats.segments.map((g, i) => (
          <div key={g.monday} title={segmentTitle(g)} className="relative min-w-0 cursor-help">
            {stats.milestoneIndex === i && (
              <span
                title="Marco (PM Review)"
                className="absolute -top-3.5 left-0 text-[9px] leading-none text-muted-foreground"
              >
                ⚑
              </span>
            )}
            <div className={cn("h-2.5 rounded-[3px]", cellClass(g))} />
            <div
              className={cn(
                "mt-1.5 h-[11px] truncate text-[11px] font-medium leading-none tabular-nums",
                segmentValueTone(g),
              )}
            >
              {segmentValueLabel(g)}
            </div>
            <div className="mt-1 text-[10px] leading-none tabular-nums text-muted-foreground/70">
              {g.monday.slice(8, 10)}/{g.monday.slice(5, 7)}
            </div>
          </div>
        ))}
      </div>
      <div className="mt-4 text-[11px] text-muted-foreground">
        <ReguaSummaryLine stats={stats} />
      </div>
    </div>
  );
}

/**
 * Gate de maturidade do pace: 3 sprints fechadas + done registrado. Antes
 * disso scopePct é dado faltante, não veredito — o gap marcharia pro
 * "crítico" sozinho conforme o calendário queima, sem o time ter culpa.
 */
function paceIsMature(stats: ProjectStats): boolean {
  return stats.sprintsClosed >= DELIVERY_MIN_SAMPLE && stats.fpDone > 0;
}

/** Amostra mínima pra ritmo virar veredito (delivery_rate e pace). */
const DELIVERY_MIN_SAMPLE = 3;

/** Entrega do planejado (project.delivery_rate) — só com amostra madura. */
function DeliveryRate({
  stats,
  bands,
  hint,
}: {
  stats: ProjectStats;
  bands: Threshold[];
  hint?: string;
}) {
  if (stats.deliveryRatePct === null || stats.deliverySprints < DELIVERY_MIN_SAMPLE) return null;
  const band = bandOf(stats.deliveryRatePct, bands);
  return (
    <span title={hint} className={cn("whitespace-nowrap", hint && "cursor-help")}>
      entregou{" "}
      <span className={cn("font-medium tabular-nums", band && TONE_CLS[band.tone])}>
        {stats.deliveryRatePct}%
      </span>{" "}
      do planejado
    </span>
  );
}

/** Veredito de pace: gap = %escopo − %prazo. Label/tom vêm do registry (D6). */
function PaceBadge({
  stats,
  bands,
  hint,
}: {
  stats: ProjectStats;
  bands: Threshold[];
  hint?: string;
}) {
  if (stats.paceGapPp === null || !paceIsMature(stats)) return null;
  const band = bandOf(stats.paceGapPp, bands);
  if (!band) return null;
  const arrow = stats.paceGapPp > 0 ? "▲" : stats.paceGapPp < 0 ? "▼" : "●";
  const pp = stats.paceVerdict === "on_track" ? "" : ` ${Math.abs(stats.paceGapPp)}pp`;
  return (
    <span
      title={hint}
      className={cn(
        "whitespace-nowrap text-[11px] font-medium tabular-nums",
        hint && "cursor-help",
        TONE_CLS[band.tone],
      )}
    >
      {arrow}
      {pp} {band.label}
    </span>
  );
}

/**
 * Linha de stats do card: posição no contrato + entrega do planejado. Só fatos
 * de calendário e a métrica autocalibrada — pace/FP-sp/buracos vivem no drawer
 * (buraco a régua já mostra como célula tracejada).
 */
function RowStatsLine({ p, ui }: { p: ProjectOverview; ui: RegistryUi }) {
  const s = p.stats;
  if (s.mode === "none") return null;
  return (
    <div className="flex flex-wrap items-center justify-end gap-x-3 gap-y-0.5 text-[11px] tabular-nums text-muted-foreground">
      {s.mode === "contract" ? (
        <span className="cursor-help" title={ui.defenses["project.sprints_elapsed"]}>
          <StatusChip
            size="sm"
            // Contrato 100% queimado (4/4) — pill verde sinaliza concluído.
            tone={s.weeksElapsed === s.weeksTotal ? "green" : "muted"}
            label={
              <>
                Sprint{" "}
                <span
                  className={cn(
                    "font-semibold tabular-nums",
                    s.weeksElapsed !== s.weeksTotal && "text-foreground",
                  )}
                >
                  {s.weeksElapsed}/{s.weeksTotal}
                </span>{" "}
                do contrato
              </>
            }
          />
        </span>
      ) : (
        <StatusChip
          size="sm"
          label={
            <>
              última{s.segments.length === 1 ? "" : "s"}{" "}
              <span className="font-semibold tabular-nums text-foreground">
                {s.segments.length}
              </span>{" "}
              sprint{s.segments.length === 1 ? "" : "s"}
            </>
          }
        />
      )}
      <DeliveryRate
        stats={s}
        bands={ui.bands["project.delivery_rate"] ?? []}
        hint={ui.defenses["project.delivery_rate"]}
      />
    </div>
  );
}

// ─── Ribbon do topo ───────────────────────────────────────

/** Eixos do ribbon — cada um abre um painel de detalhe abaixo da banda. */
type RibbonAxis = "lines" | "buffer" | "clients" | "attention" | "utilization" | "load";

type RibbonItem = {
  key: RibbonAxis;
  label: string;
  value: string;
  tone?: "amber" | "red";
};

/**
 * Banda fina de KPIs da fábrica — valor herói, label apagado, tabular-nums.
 * Cada item é trigger de um painel expansível abaixo da banda (RibbonPanel),
 * espelhando o padrão do SprintRibbon da página de projeto.
 */
function OverviewRibbon({
  items,
  active,
  onToggle,
}: {
  items: RibbonItem[];
  active: RibbonAxis | null;
  onToggle: (axis: RibbonAxis) => void;
}) {
  return (
    <div className="flex flex-wrap items-stretch gap-y-3 border-y border-border py-3">
      {items.map((item, i) => (
        <div key={item.key} className={cn("pr-5", i > 0 && "border-l border-border pl-5")}>
          <button
            type="button"
            onClick={() => onToggle(item.key)}
            aria-expanded={active === item.key}
            aria-controls="overview-ribbon-panel"
            className={cn(
              "-mx-1.5 -my-1 flex min-w-0 flex-col gap-0.5 rounded-md px-1.5 py-1 text-left transition-colors hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              active === item.key && "bg-muted/40",
            )}
          >
            <span
              className={cn(
                "text-xl font-semibold leading-none tabular-nums",
                item.tone === "amber" && "text-yellow-500",
                item.tone === "red" && "text-red-400",
              )}
            >
              {item.value}
            </span>
            <span className="flex items-center gap-1 text-[10px] uppercase tracking-wider text-muted-foreground">
              {item.label}
              <ChevronDown
                className={cn(
                  "h-3 w-3 opacity-50 transition-transform",
                  active === item.key && "rotate-180",
                )}
              />
            </span>
          </button>
        </div>
      ))}
    </div>
  );
}

// ─── Painel do ribbon (detalhe por eixo) ──────────────────

/** Linha de projeto dentro do painel — clique abre o drawer do projeto. */
function PanelProjectRow({
  p,
  right,
  onOpen,
}: {
  p: ProjectOverview;
  right?: React.ReactNode;
  onOpen: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <span className={cn("h-1.5 w-1.5 shrink-0 rounded-full", HEALTH_DOT[p.health])} />
      <span className="truncate font-medium">{p.name}</span>
      <span className="hidden truncate text-xs text-muted-foreground sm:inline">
        {p.clientName ?? "—"}
      </span>
      {right && (
        <span className="ml-auto flex shrink-0 items-center gap-2 text-[11px] tabular-nums text-muted-foreground">
          {right}
        </span>
      )}
    </button>
  );
}

/** Barra horizontal simples 0–100 (capada) pros breakdowns do painel. */
function PanelBar({ pct, cls = "bg-primary/60" }: { pct: number; cls?: string }) {
  return (
    <span className="h-1.5 w-20 shrink-0 overflow-hidden rounded bg-muted sm:w-28">
      <span
        className={cn("block h-full rounded", cls)}
        style={{ width: `${Math.min(100, Math.max(0, pct))}%` }}
      />
    </span>
  );
}

/**
 * Painel expansível abaixo do ribbon — espelha o RibbonDrawer do SprintRibbon
 * (max-height + opacity). Abre com a defense do registry (D6) e o detalhamento
 * do eixo; linhas de projeto abrem o drawer do projeto.
 */
function RibbonPanel({
  axis,
  projects,
  factoryLoad,
  builderLoads,
  ui,
  onOpenProject,
}: {
  axis: RibbonAxis | null;
  projects: ProjectOverview[];
  factoryLoad: MetricValue;
  builderLoads: Array<{ memberId: string; name: string; committed: number; capacity: number }>;
  ui: RegistryUi;
  onOpenProject: (id: string) => void;
}) {
  const open = axis !== null;
  const universe = projects.filter((p) => p.category !== "internal" && !p.isEval);
  const lines = universe.filter(
    (p) => p.status === "active" && PRODUCING_PHASES.includes(p.phase),
  );

  let defense: string | undefined;
  let content: React.ReactNode = null;

  if (axis === "lines") {
    defense = ui.defenses["factory.lines_active"];
    content = (
      <div className="space-y-0.5">
        {lines.map((p) => (
          <PanelProjectRow
            key={p.id}
            p={p}
            onOpen={() => onOpenProject(p.id)}
            right={
              <>
                <span className="hidden sm:inline">{lookupChip(PROJECT_PHASE, p.phase).label}</span>
                <PaceBadge stats={p.stats} bands={ui.bands["project.pace_gap"] ?? []} />
              </>
            }
          />
        ))}
        {lines.length === 0 && (
          <p className="px-2 text-xs text-muted-foreground">Nenhuma linha em produção.</p>
        )}
      </div>
    );
  } else if (axis === "buffer") {
    const buffer = universe.filter((p) => p.status === "active" && p.phase === "commercial");
    defense = ui.defenses["factory.commercial_buffer"];
    content = (
      <div className="space-y-0.5">
        {buffer.map((p) => (
          <PanelProjectRow
            key={p.id}
            p={p}
            onOpen={() => onOpenProject(p.id)}
            right={
              <span>
                em comercial há {p.daysInPhase}d · {horizonLabel(p)}
              </span>
            }
          />
        ))}
        {buffer.length === 0 && (
          <p className="px-2 text-xs text-muted-foreground">Buffer vazio — nada em comercial.</p>
        )}
      </div>
    );
  } else if (axis === "clients") {
    const byClient = new Map<string, ProjectOverview[]>();
    for (const p of lines) {
      if (!p.clientName) continue;
      byClient.set(p.clientName, [...(byClient.get(p.clientName) ?? []), p]);
    }
    defense = ui.defenses["factory.clients_active"];
    content = (
      <div className="space-y-2">
        {[...byClient.entries()]
          .sort((a, b) => b[1].length - a[1].length)
          .map(([client, ps]) => (
            <div key={client} className="px-2 text-sm">
              <span className="font-medium">{client}</span>{" "}
              <span className="text-xs text-muted-foreground">
                — {ps.length} linha{ps.length === 1 ? "" : "s"}: {ps.map((p) => p.name).join(", ")}
              </span>
            </div>
          ))}
        {byClient.size === 0 && (
          <p className="px-2 text-xs text-muted-foreground">Nenhum cliente com produção ativa.</p>
        )}
      </div>
    );
  } else if (axis === "attention") {
    const attention = lines.filter((p) => p.health !== "green");
    defense = "Linhas ativas com health diferente de verde — os motivos ao lado (sinal local, não métrica do registry).";
    content = (
      <div className="space-y-0.5">
        {attention.map((p) => {
          const reasons = signalChips(p).map((c) => c.label);
          if ((p.pmReview?.notesByKind.risk?.length ?? 0) === 0 && reasons.length === 0)
            reasons.push("carga/decisões pendentes");
          return (
            <PanelProjectRow
              key={p.id}
              p={p}
              onOpen={() => onOpenProject(p.id)}
              right={<span className="truncate">{reasons.join(" · ")}</span>}
            />
          );
        })}
        {attention.length === 0 && (
          <p className="px-2 text-xs text-muted-foreground">Tudo verde.</p>
        )}
      </div>
    );
  } else if (axis === "utilization") {
    const sampled = lines.filter((p) => p.stats.utilizationPct !== null);
    const noSample = lines.filter((p) => p.stats.utilizationPct === null);
    defense = ui.defenses["factory.utilization"];
    content = (
      <div className="space-y-0.5">
        {sampled
          .sort((a, b) => (b.stats.utilizationPct ?? 0) - (a.stats.utilizationPct ?? 0))
          .map((p) => (
            <PanelProjectRow
              key={p.id}
              p={p}
              onOpen={() => onOpenProject(p.id)}
              right={
                <>
                  <PanelBar pct={p.stats.utilizationPct ?? 0} />
                  <span className="w-9 text-right">{p.stats.utilizationPct}%</span>
                </>
              }
            />
          ))}
        {sampled.length === 0 && (
          <p className="px-2 text-xs text-muted-foreground">Nenhuma linha com amostra de FP.</p>
        )}
        {noSample.length > 0 && (
          <p className="px-2 pt-1.5 text-xs text-muted-foreground/70">
            Sem amostra (sprints fechadas sem FP): {noSample.map((p) => p.name).join(", ")}
          </p>
        )}
      </div>
    );
  } else if (axis === "load") {
    const bands = ui.bands["factory.committed_vs_capacity"] ?? [];
    defense = ui.defenses["factory.committed_vs_capacity"];
    const rows = [...builderLoads].sort(
      (a, b) =>
        (a.capacity > 0 ? a.committed / a.capacity : 0) -
        (b.capacity > 0 ? b.committed / b.capacity : 0),
    );
    content = (
      <div className="space-y-0.5">
        {factoryLoad.components && (
          <p className="px-2 pb-1.5 text-xs text-muted-foreground">
            Total: {factoryLoad.components.committed}/{factoryLoad.components.capacity} FP
            comprometidos em {factoryLoad.components.builders} builders. Ociosos primeiro:
          </p>
        )}
        {rows.map((b) => {
          const pct = b.capacity > 0 ? Math.round((b.committed / b.capacity) * 100) : null;
          const band = pct !== null ? bandOf(pct, bands) : null;
          return (
            <div key={b.memberId} className="flex items-center gap-2 px-2 py-1 text-sm">
              <span className="truncate">{b.name}</span>
              <span className="ml-auto flex shrink-0 items-center gap-2 text-[11px] tabular-nums text-muted-foreground">
                <span>
                  {b.committed}/{b.capacity} FP
                </span>
                <PanelBar
                  pct={pct ?? 0}
                  cls={
                    band?.tone === "red" || band?.tone === "critical"
                      ? "bg-red-400/80"
                      : band?.tone === "amber"
                        ? "bg-yellow-500/70"
                        : "bg-emerald-500/70"
                  }
                />
                <span className={cn("w-24 text-right", band && TONE_CLS[band.tone])}>
                  {pct === null ? "sem capacity" : `${pct}% ${band?.label ?? ""}`}
                </span>
              </span>
            </div>
          );
        })}
        {rows.length === 0 && (
          <p className="px-2 text-xs text-muted-foreground">Nenhum product-builder cadastrado.</p>
        )}
      </div>
    );
  }

  return (
    <div
      id="overview-ribbon-panel"
      role="region"
      aria-label="Detalhe do indicador"
      aria-hidden={!open}
      className={cn(
        "overflow-hidden border-b bg-muted/30 transition-[max-height,opacity] duration-200 ease-out",
        open ? "max-h-[480px] opacity-100" : "max-h-0 border-transparent opacity-0",
      )}
    >
      <div className="max-h-[460px] overflow-y-auto px-2 py-3">
        {defense && <p className="px-2 pb-2 text-xs text-muted-foreground">{defense}</p>}
        {content}
      </div>
    </div>
  );
}

// ─── Linha de projeto (ribbon filho) ──────────────────────

function ProjectRow({
  p,
  ui,
  onOpen,
}: {
  p: ProjectOverview;
  ui: RegistryUi;
  onOpen: () => void;
}) {
  const milestone = milestoneChip(p);
  const motivo = cardMotivo(p);
  const producing = PRODUCING_PHASES.includes(p.phase);

  return (
    <button
      type="button"
      data-overview-row
      onClick={onOpen}
      className="surface block w-full p-3 text-left transition-colors hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <div className="flex items-center gap-2.5">
        <span className={cn("h-2 w-2 shrink-0 rounded-full", HEALTH_DOT[p.health])} />
        <span className="truncate text-sm font-semibold">{p.name}</span>
        <span className="hidden truncate text-xs text-muted-foreground sm:inline">
          {p.clientName ?? "—"}
          {p.pmName ? ` · ${p.pmName}` : ""}
        </span>
        {p.status === "paused" && (
          <StatusChip label="pausado" tone="muted" variant="subtle" size="sm" />
        )}
        <span className="ml-auto flex shrink-0 items-center gap-1">
          {milestone && (
            <StatusChip
              label={milestone.label}
              tone={milestone.tone}
              variant="subtle"
              size="sm"
              className="max-w-[220px]"
            />
          )}
          {motivo && (
            <StatusChip label={motivo.label} tone={motivo.tone} variant="subtle" size="sm" />
          )}
        </span>
      </div>

      <div className="mt-2 flex items-center gap-3 pl-[18px]">
        {p.stats.mode !== "none" ? (
          <>
            <div className="min-w-0 flex-1">
              <Regua stats={p.stats} />
            </div>
            <div className="shrink-0">
              <RowStatsLine p={p} ui={ui} />
            </div>
          </>
        ) : p.phase === "commercial" ? (
          <p className="text-[11px] text-muted-foreground">
            Em comercial há {p.daysInPhase}d · {horizonLabel(p)}
          </p>
        ) : producing ? (
          <p className="flex items-center gap-1.5 text-[11px] text-yellow-500">
            <AlertTriangle className="h-3 w-3" /> produção sem sprint — régua vazia
          </p>
        ) : (
          <p className="text-[11px] text-muted-foreground">{horizonLabel(p)}</p>
        )}
      </div>
    </button>
  );
}

// ─── Kanban (view alternativa: fases como colunas) ────────

/**
 * Card do kanban — mesma leitura da ProjectRow (health, régua, motivo, marco)
 * em formato vertical. Clique abre o drawer; o wrapper draggable vive no
 * ProjetosKanban (drop muda a fase).
 */
function ProjectKanbanCard({ p, onOpen }: { p: ProjectOverview; onOpen: () => void }) {
  const milestone = milestoneChip(p);
  const motivo = cardMotivo(p);
  const producing = PRODUCING_PHASES.includes(p.phase);
  return (
    <button
      type="button"
      data-overview-row
      onClick={onOpen}
      className="surface block w-full p-3 text-left transition-colors hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <div className="flex items-center gap-2">
        <span className={cn("h-2 w-2 shrink-0 rounded-full", HEALTH_DOT[p.health])} />
        <span className="truncate text-sm font-semibold">{p.name}</span>
        {p.status === "paused" && (
          <StatusChip label="pausado" tone="muted" variant="subtle" size="sm" />
        )}
      </div>
      <p className="mt-0.5 truncate pl-4 text-xs text-muted-foreground">
        {p.clientName ?? "—"}
        {p.pmName ? ` · ${p.pmName}` : ""}
      </p>
      <div className="mt-2 pl-4">
        {p.stats.mode !== "none" ? (
          <Regua stats={p.stats} />
        ) : p.phase === "commercial" ? (
          <p className="text-[11px] text-muted-foreground">
            Em comercial há {p.daysInPhase}d · {horizonLabel(p)}
          </p>
        ) : producing ? (
          <p className="flex items-center gap-1.5 text-[11px] text-yellow-500">
            <AlertTriangle className="h-3 w-3" /> produção sem sprint
          </p>
        ) : (
          <p className="text-[11px] text-muted-foreground">{horizonLabel(p)}</p>
        )}
      </div>
      {(milestone || motivo) && (
        <div className="mt-2 flex flex-wrap items-center gap-1 pl-4">
          {milestone && (
            <StatusChip
              label={milestone.label}
              tone={milestone.tone}
              variant="subtle"
              size="sm"
              className="max-w-full"
            />
          )}
          {motivo && (
            <StatusChip label={motivo.label} tone={motivo.tone} variant="subtle" size="sm" />
          )}
        </div>
      )}
    </button>
  );
}

/**
 * Kanban do funil — uma coluna por fase (PHASE_ORDER), sempre as 4 visíveis
 * pra servirem de drop target. Drag nativo HTML5 (idiom do PlanningBoard);
 * soltar num coluna chama onPhaseChange, que persiste e re-agrupa.
 */
function ProjetosKanban({
  projects,
  onOpen,
  onPhaseChange,
}: {
  projects: ProjectOverview[];
  onOpen: (id: string) => void;
  onPhaseChange: (id: string, phase: ProjectPhase) => void;
}) {
  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
      {PHASE_ORDER.map((phase) => {
        const items = projects.filter((p) => p.phase === phase);
        const attention = items.filter((p) => p.health !== "green").length;
        const Icon = PHASE_ICON[phase];
        return (
          <BoardColumn
            key={phase}
            accent={PHASE_ACCENT[phase]}
            icon={<Icon className="size-4" />}
            title={lookupChip(PROJECT_PHASE, phase).label}
            subtitle={attention > 0 ? `${attention} em atenção` : undefined}
            count={items.length}
            countLabel="projeto"
            className="min-h-[280px]"
          >
            {/* Empty state mora DENTRO da drop-zone — o emptyTitle do
                BoardColumn substituiria os children e mataria o onDrop. */}
            <div
              className="h-full min-h-[140px] space-y-2.5"
              onDragOver={(e) => {
                e.preventDefault();
                e.dataTransfer.dropEffect = "move";
              }}
              onDrop={(e) => {
                e.preventDefault();
                const id = e.dataTransfer.getData("project-id");
                if (id) onPhaseChange(id, phase);
              }}
            >
              {items.length === 0 && (
                <div className="flex h-full min-h-[120px] flex-col items-center justify-center gap-1.5 rounded-md border border-dashed border-border/60 py-6 text-center">
                  <FolderKanban className="size-5 text-muted-foreground/50" />
                  <p className="text-xs text-muted-foreground">Nenhum projeto</p>
                  <p className="text-[11px] text-muted-foreground/70">
                    Arraste um card pra cá.
                  </p>
                </div>
              )}
              {items.map((p) => (
                <div
                  key={p.id}
                  draggable
                  onDragStart={(e) => {
                    e.dataTransfer.effectAllowed = "move";
                    e.dataTransfer.setData("project-id", p.id);
                  }}
                  className="cursor-move"
                >
                  <ProjectKanbanCard p={p} onOpen={() => onOpen(p.id)} />
                </div>
              ))}
            </div>
          </BoardColumn>
        );
      })}
    </div>
  );
}

// ─── Ribbon Pai (grupo por fase, sticky) ──────────────────

function PhaseHeader({
  phase,
  items,
  collapsed,
  onToggle,
}: {
  phase: ProjectPhase;
  items: ProjectOverview[];
  collapsed: boolean;
  onToggle: () => void;
}) {
  const attention = items.filter((p) => p.health !== "green").length;
  const worst = items.reduce<ProjectHealth>(
    (acc, p) => (HEALTH_RANK[p.health] < HEALTH_RANK[acc] ? p.health : acc),
    "green",
  );
  const avg = meanOf(items.map((p) => p.stats.avgFpPerSprint));
  return (
    <button
      type="button"
      onClick={onToggle}
      className="sticky top-0 z-10 flex w-full items-center gap-2 border-b border-border bg-background/95 py-2 text-left backdrop-blur focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <ChevronDown
        className={cn(
          "h-3.5 w-3.5 text-muted-foreground transition-transform",
          collapsed && "-rotate-90",
        )}
      />
      <span className="text-xs font-semibold uppercase tracking-wider">
        {lookupChip(PROJECT_PHASE, phase).label}
      </span>
      <span className="text-xs tabular-nums text-muted-foreground">({items.length})</span>
      {/* Grupo colapsado nunca esconde incêndio: pior health sempre visível */}
      {worst !== "green" && <span className={cn("h-1.5 w-1.5 rounded-full", HEALTH_DOT[worst])} />}
      <span className="ml-auto flex items-center gap-3 text-[11px] tabular-nums text-muted-foreground">
        {attention > 0 && <span className="text-yellow-500">{attention} em atenção</span>}
        {avg !== null && <span className="hidden sm:inline">média {fmtAvg(avg)}</span>}
      </span>
    </button>
  );
}

// ─── Digest do PM Review (cards do drawer) ────────────────

/** Slot sem conteúdo — uma linha (título + estado vazio juntos), sem caixa cheia. */
function EmptySlot({ title, text }: { title: string; text: string }) {
  return (
    <div className="surface-inset flex items-baseline gap-2 px-3 py-1.5">
      <h5 className="shrink-0 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
        {title}
      </h5>
      <p className="truncate text-xs text-muted-foreground/60">{text}</p>
    </div>
  );
}

/**
 * Slot Panorama — narrativa da semana (summary + rumo fundidos), texto
 * integral. O drawer é a camada de leitura: truncar aqui forçaria um 4º
 * nível de clique — quem precisa de menos texto resolve na origem (Vitoria).
 */
function PanoramaCard({ notes }: { notes: Record<string, PMReviewNoteLite[]> }) {
  const summary = notes.summary?.[0]?.content;
  const direction = notes.project_direction?.[0]?.content;
  if (!summary && !direction) {
    return <EmptySlot title="Panorama" text="Sem panorama esta semana." />;
  }
  return (
    <div className="surface-inset p-3">
      <h5 className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
        Panorama
      </h5>
      <div className="mt-1.5 space-y-1.5">
        {summary && <p className="text-sm leading-relaxed">{summary}</p>}
        {direction && (
          <p className="text-xs leading-relaxed text-muted-foreground">
            <span className="text-[10px] font-medium uppercase tracking-wide">Rumo</span>{" "}
            {direction}
          </p>
        )}
      </div>
    </div>
  );
}

/**
 * Slot fixo do digest — lista capada por priority, texto integral (sem clamp:
 * o drawer é a camada de leitura; o cap de itens + "+N" segura a altura).
 */
function DigestCard({
  title,
  items,
  emptyText,
  showKindLabel = false,
}: {
  title: string;
  items: PMReviewNoteLite[];
  emptyText: string;
  /** Liga o mini-rótulo por item em slots que misturam kinds (Decisões/Precisa). */
  showKindLabel?: boolean;
}) {
  const shown = items.slice(0, DIGEST_MAX);
  const overflow = items.length - shown.length;
  if (items.length === 0) {
    return <EmptySlot title={title} text={emptyText} />;
  }
  return (
    <div className="surface-inset p-3">
      <h5 className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
        {title}
        <span className="font-normal"> ({items.length})</span>
      </h5>
      <ul className="mt-1.5 space-y-2">
        {shown.map((n, i) => (
            <li key={i} className="flex gap-2">
              <span
                className={cn(
                  "mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full",
                  KIND_META[n.kind]?.dot ?? "bg-muted-foreground",
                )}
              />
              <p className="min-w-0 flex-1 text-sm leading-relaxed">
                {showKindLabel && (
                  <span className="mr-1.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                    {KIND_META[n.kind]?.label ?? n.kind}
                  </span>
                )}
                {n.content}
              </p>
            </li>
        ))}
      </ul>
      {overflow > 0 && (
        <p className="mt-1.5 text-[11px] text-muted-foreground">
          +{overflow} no review completo
        </p>
      )}
    </div>
  );
}

/** Seção PM Review do drawer: chips de semana + 4 slots fixos. */
function PMReviewSection({ p }: { p: ProjectOverview }) {
  // Tela cheia: Riscos e Próximos passos dividem a linha (a largura permite).
  const expanded = useResponsiveSheetExpanded();
  // Chips navegam entre as semanas da janela. null = default (semana corrente
  // ou última). Troca de projeto se auto-corrige: id que não existe na janela
  // nova cai no default via `?? p.pmReview`.
  const [weekId, setWeekId] = useState<string | null>(null);
  const shownReview = p.weeks.find((w) => w.review?.id === weekId)?.review ?? p.pmReview;
  // Cards leem o digest: curado pela Vitoria quando existir, senão fallback
  // mecânico nas notes detail. priority desc = mais importante primeiro.
  const digest = shownReview?.digestByKind ?? {};
  const decisions = [...(digest.open_decision ?? []), ...(digest.need ?? [])].sort(
    (a, b) => b.priority - a.priority,
  );

  return (
    <section>
      <div className="mb-2 flex items-center justify-between gap-2">
        <h4 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          PM Review
          {shownReview && (
            <span className="font-normal normal-case text-muted-foreground/80">
              · semana {fmtDate(new Date(shownReview.referenceWeek))}
              {shownReview.isCurrentWeek
                ? ""
                : shownReview.id === p.pmReview?.id
                  ? " (última)"
                  : ""}
              {shownReview.publishedAt && (
                <span className="text-muted-foreground/50">
                  {" "}· feita {fmtDate(new Date(shownReview.publishedAt))}
                </span>
              )}
            </span>
          )}
        </h4>
        {shownReview && (
          <Link
            href={`/pm-reviews/${shownReview.id}`}
            className="shrink-0 text-xs font-medium text-primary hover:underline"
          >
            Abrir →
          </Link>
        )}
      </div>

      {/* Janela fixa: chip por semana, desabilitado quando não há review */}
      <div className="mb-2 flex flex-wrap gap-1">
        {p.weeks.map((w) => {
          const review = w.review;
          const label = fmtDate(new Date(w.week));
          if (!review) {
            return (
              <span
                key={w.week}
                title="Sem PM Review nesta semana"
                className="cursor-default rounded-full border border-dashed border-border/60 px-2 py-0.5 text-[11px] text-muted-foreground/50"
              >
                {label}
              </span>
            );
          }
          const active = review.id === shownReview?.id;
          return (
            <button
              key={w.week}
              type="button"
              title={
                review.publishedAt
                  ? `Feita em ${fmtDate(new Date(review.publishedAt))}`
                  : undefined
              }
              onClick={() => setWeekId(review.id)}
              className={cn(
                "rounded-full border px-2 py-0.5 text-[11px] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                active
                  ? "border-primary/40 bg-primary/10 font-medium text-primary"
                  : "border-border text-muted-foreground hover:text-foreground",
              )}
            >
              {label}
            </button>
          );
        })}
      </div>

      {!shownReview ? (
        <p className="text-sm text-muted-foreground">Sem PM Review registrado.</p>
      ) : (
        // 1 card por linha (mesmo no desktop): largura inteira por frase —
        // o clamp de 2 linhas segura a ideia completa, fonte maior. Exceção:
        // sheet expandida emparelha Riscos + Próximos na coluna de leitura.
        <div className="space-y-2">
          <PanoramaCard notes={digest} />
          <div className={cn(expanded ? "grid gap-2 lg:grid-cols-2" : "space-y-2")}>
            <DigestCard title="Riscos" items={digest.risk ?? []} emptyText="Sem riscos esta semana." />
            <DigestCard
              title="Próximos passos"
              items={digest.next_step ?? []}
              emptyText="Sem próximos passos."
            />
          </div>
          <DigestCard
            title="Decisões / Precisa"
            items={decisions}
            emptyText="Nada aguardando decisão."
            showKindLabel
          />
        </div>
      )}
    </section>
  );
}

// ─── STATS (drawer) ───────────────────────────────────────

/**
 * Tooltip de defesa (D6) no drawer — controlled mirror: hover/focus do Base UI
 * continuam valendo (todo onOpenChange é espelhado) e o onClick cobre tap no
 * mobile, que o Base UI ignora por design.
 */
function StatTip({
  hint,
  block = false,
  children,
}: {
  hint?: React.ReactNode;
  /** Trigger como div block (célula de grid) em vez de span inline. */
  block?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const lastToggle = useRef(0);
  if (!hint) return <>{children}</>;
  const onToggle = () => {
    lastToggle.current = Date.now();
    setOpen((o) => !o);
  };
  // Base UI fecha tooltip no press do trigger — ignora esse close imediato
  // pra não desfazer o toggle do tap.
  const onOpenChange = (o: boolean) => {
    if (!o && Date.now() - lastToggle.current < 400) return;
    setOpen(o);
  };
  const triggerCls =
    "cursor-help rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";
  return (
    <Tooltip open={open} onOpenChange={onOpenChange}>
      <TooltipTrigger
        render={
          block ? (
            <div tabIndex={0} onClick={onToggle} className={cn("min-w-0", triggerCls)} />
          ) : (
            <span tabIndex={0} onClick={onToggle} className={triggerCls} />
          )
        }
      >
        {children}
      </TooltipTrigger>
      <TooltipContent>{hint}</TooltipContent>
    </Tooltip>
  );
}

function StatCol({
  label,
  value,
  sub,
  subTone,
  hint,
}: {
  label: string;
  value: string;
  sub?: string | null;
  subTone?: "amber" | "red";
  /** Defense do registry (D6) — a frase que explica o número, como tooltip. */
  hint?: string;
}) {
  return (
    <div className="min-w-0">
      <div className="flex items-center gap-1 text-[10px] uppercase tracking-wider text-muted-foreground">
        {label}
        {hint && (
          <StatTip hint={hint}>
            <Info className="h-3 w-3 shrink-0 opacity-50 transition-opacity hover:opacity-100" />
          </StatTip>
        )}
      </div>
      <div className="mt-0.5 truncate text-lg font-semibold tabular-nums">{value}</div>
      {sub && (
        <div
          className={cn(
            "truncate text-[11px] tabular-nums text-muted-foreground",
            subTone === "amber" && "text-yellow-500",
            subTone === "red" && "text-red-400",
          )}
        >
          {sub}
        </div>
      )}
    </div>
  );
}

/**
 * Coluna "Marco" — próxima grande data do projeto (go-live, demo, entrega de
 * fase), declarada pela Vitoria no PM Review (note kind='milestone' + dueAt).
 */
function MilestoneStatCol({ p }: { p: ProjectOverview }) {
  const hint =
    "Próxima grande data do projeto (go-live, demo, entrega de fase). A Vitoria declara no PM Review semanal — sem review com marco, a coluna fica vazia.";
  if (!p.milestone) {
    return <StatCol label="Marco" value="—" sub="sem marco declarado" hint={hint} />;
  }
  const due = new Date(`${p.milestone.dueAt}T00:00:00`);
  const days = daysUntil(p.milestone.dueAt);
  const sub =
    days < 0
      ? `${p.milestone.label} · venceu há ${Math.abs(days)}d`
      : days === 0
        ? `${p.milestone.label} · é hoje`
        : `${p.milestone.label} · em ${days}d`;
  return (
    <StatCol
      label="Marco"
      value={fmtDate(due)}
      sub={sub}
      subTone={days < 0 ? "red" : days <= 14 ? "amber" : undefined}
      hint={hint}
    />
  );
}

/** Sub da coluna Ritmo no drawer — entrega do planejado (madura) + aproveitamento. */
function ritmoSub(s: ProjectStats): string {
  const parts = [
    s.deliveryRatePct !== null && s.deliverySprints >= DELIVERY_MIN_SAMPLE
      ? `entrega ${s.deliveryRatePct}% do planejado`
      : null,
    s.utilizationPct !== null ? `aproveitamento ${s.utilizationPct}%` : null,
  ].filter(Boolean);
  return parts.length > 0 ? parts.join(" · ") : "ritmo das últimas 6 sprints fechadas";
}

/**
 * Dossiê de STATS: régua grande + PRAZO / MARCO / RITMO + projeção.
 * Fórmulas: docs/features/overview/stats-dictionary.md (gerado do registry).
 */
function StatsSection({ p, ui }: { p: ProjectOverview; ui: RegistryUi }) {
  const s = p.stats;
  const producing = PRODUCING_PHASES.includes(p.phase);
  // Tela cheia (sheet expandida): a régua vira timeline com data + entrega.
  const expanded = useResponsiveSheetExpanded();

  if (s.mode === "none") {
    return (
      <section>
        <h4 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Stats
        </h4>
        {p.phase === "commercial" ? (
          <p className="text-sm text-muted-foreground">
            Em comercial há {p.daysInPhase}d · {horizonLabel(p)}. Sprints começam na Imersão.
          </p>
        ) : producing ? (
          <p className="flex items-center gap-1.5 text-sm text-yellow-500">
            <AlertTriangle className="h-4 w-4" /> Fase de produção sem nenhuma sprint — a régua
            nasce na primeira sprint criada.
          </p>
        ) : (
          <p className="text-sm text-muted-foreground">{horizonLabel(p)}</p>
        )}
      </section>
    );
  }

  return (
    <TooltipProvider>
      <section>
        <div className="mb-2 flex items-baseline justify-between gap-2">
          <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Stats
          </h4>
          {s.mode === "contract" && p.startDate && p.endDate && (
            <span className="text-[11px] tabular-nums text-muted-foreground">
              {fmtDate(new Date(p.startDate))} → {fmtDate(new Date(p.endDate))}
            </span>
          )}
        </div>

        {expanded ? (
          <SprintTimeline stats={s} />
        ) : (
          <StatTip hint={<ReguaSummaryTip stats={s} />} block>
            <Regua stats={s} size="lg" legend={false} />
          </StatTip>
        )}

        <div className="mt-3 grid grid-cols-3 gap-3">
          {s.mode === "contract" ? (
            <>
              <StatCol
                label="Contrato"
                value={`sprint ${s.weeksElapsed}/${s.weeksTotal}`}
                sub={`${s.timePct}% do contrato consumido`}
                hint={ui.defenses["project.time_pct"]}
              />
              <MilestoneStatCol p={p} />
              <StatCol
                label="Ritmo"
                value={fmtAvg(s.avgFpPerSprint)}
                sub={ritmoSub(s)}
                hint={ui.defenses["project.avg_fp_per_sprint"]}
              />
            </>
          ) : (
            <>
              <StatCol
                label="Janela"
                value={`${s.segments.length} sprint${s.segments.length === 1 ? "" : "s"}`}
                sub="contínuo — sem prazo"
              />
              <MilestoneStatCol p={p} />
              <StatCol
                label="Ritmo"
                value={fmtAvg(s.avgFpPerSprint)}
                sub={ritmoSub(s)}
                hint={ui.defenses["project.avg_fp_per_sprint"]}
              />
            </>
          )}
        </div>

        {s.mode === "contract" && (
          <p className="mt-3 text-[11px] tabular-nums text-muted-foreground">
            {paceIsMature(s) && s.paceGapPp !== null ? (
              <>
                Pace:{" "}
                <PaceBadge
                  stats={s}
                  bands={ui.bands["project.pace_gap"] ?? []}
                  hint={ui.defenses["project.pace_gap"]}
                />
              </>
            ) : (
              <span className="cursor-help" title={ui.defenses["project.pace_gap"]}>
                Pace em calibração — aparece com {DELIVERY_MIN_SAMPLE} sprints fechadas e FP
                done registrado.
              </span>
            )}
          </p>
        )}
      </section>
    </TooltipProvider>
  );
}

// ─── Drawer ───────────────────────────────────────────────

function ProjectDrawer({
  p,
  index,
  total,
  ui,
  onPrev,
  onNext,
  onEdit,
}: {
  p: ProjectOverview;
  index: number;
  total: number;
  ui: RegistryUi;
  onPrev: () => void;
  onNext: () => void;
  onEdit: () => void;
}) {
  const chips = signalChips(p);
  return (
    <>
      <ResponsiveSheetHeader>
        {/* Linha utilitária: navegação seriada à esquerda, ações à direita
            (mr limpa o X + o toggle de tela cheia do sheet) */}
        <div className="mr-14 flex items-center gap-1.5 text-xs tabular-nums text-muted-foreground">
          <button
            type="button"
            onClick={onPrev}
            disabled={index <= 0}
            aria-label="Projeto anterior"
            className="rounded p-0.5 hover:bg-muted disabled:opacity-30"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={onNext}
            disabled={index >= total - 1}
            aria-label="Próximo projeto"
            className="rounded p-0.5 hover:bg-muted disabled:opacity-30"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
          <span>
            {index + 1} de {total}
          </span>
          <span className="ml-auto flex items-center gap-1.5">
            <Button
              variant="ghost"
              size="sm"
              onClick={onEdit}
              className="gap-1.5 text-muted-foreground"
            >
              <Pencil className="h-3.5 w-3.5" /> Editar
            </Button>
            <Link
              href={`/projects/${p.id}`}
              className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
            >
              Ver projeto <ArrowUpRight className="h-3 w-3" />
            </Link>
          </span>
        </div>
        <div className="mt-1 flex items-center gap-2.5">
          <span className={cn("h-2.5 w-2.5 shrink-0 rounded-full", HEALTH_DOT[p.health])} />
          <ResponsiveSheetTitle className="truncate">{p.name}</ResponsiveSheetTitle>
        </div>
        <p className="text-xs text-muted-foreground">
          {p.clientName ?? "—"}
          {p.pmName ? ` · PM ${p.pmName}` : ""}
        </p>
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          <StatusChip {...lookupChip(PROJECT_PHASE, p.phase)} variant="subtle" size="sm" />
          <StatusChip {...lookupChip(PROJECT_ENGAGEMENT, p.engagementType)} variant="subtle" size="sm" />
          {p.status === "paused" && (
            <StatusChip label="pausado" tone="muted" variant="subtle" size="sm" />
          )}
        </div>
      </ResponsiveSheetHeader>

      <ResponsiveSheetBody className="space-y-5">
        <StatsSection p={p} ui={ui} />
        <PMReviewSection p={p} />

        {/* Rodapé quieto: sinais + time, sem caixas */}
        <section className="flex flex-wrap items-center justify-between gap-2 border-t border-border pt-3">
          <p className="text-[11px] tabular-nums text-muted-foreground">
            {chips.length > 0
              ? chips.map((c) => c.label).join(" · ")
              : "sem pendências operacionais"}
          </p>
          <TeamStack team={p.team} max={6} />
        </section>
      </ResponsiveSheetBody>
    </>
  );
}

// ─── Board ────────────────────────────────────────────────

export function ProjetosBoard({
  projects,
  factoryLoad,
  builderLoads,
  registryUi: ui,
}: {
  projects: ProjectOverview[];
  /** factory.committed_vs_capacity computado no server (computeMetric). */
  factoryLoad: MetricValue;
  /** Carga por builder (member_commitment_overview) — painel do eixo "load". */
  builderLoads: Array<{ memberId: string; name: string; committed: number; capacity: number }>;
  /** Vocabulário do registry (names/defenses/bands), resolvido no server. */
  registryUi: RegistryUi;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const rowsRef = useRef<HTMLDivElement>(null);
  const [showInternal, setShowInternal] = useState(false);
  const [showEval, setShowEval] = useState(false);
  const [collapsed, setCollapsed] = useState<Set<ProjectPhase>>(new Set());
  const [editProject, setEditProject] = useState<ProjectEditInitial | null>(null);
  const [editOpen, setEditOpen] = useState(false);
  /** Eixo do ribbon expandido — null = painel fechado. */
  const [ribbonAxis, setRibbonAxis] = useState<RibbonAxis | null>(null);
  // Lista ou kanban — preferência persiste em localStorage (idiom de
  // use-chat-plan-mode: lazy init com guard de window).
  const [view, setView] = useState<BoardView>(() => readStoredView());
  // Drag no kanban muda a fase otimisticamente por cima dos props (o board é
  // server-fed); router.refresh() re-busca e o override vira redundante
  // quando o prop alcança. Erro remove o override → card volta sozinho.
  const [phaseOverrides, setPhaseOverrides] = useState<Record<string, ProjectPhase>>({});

  const effective = useMemo(
    () =>
      projects.map((p) => {
        const o = phaseOverrides[p.id];
        return o && o !== p.phase ? { ...p, phase: o } : p;
      }),
    [projects, phaseOverrides],
  );

  function switchView(v: BoardView) {
    setView(v);
    try {
      window.localStorage.setItem(VIEW_STORAGE_KEY, v);
    } catch {
      // localStorage bloqueado — preferência vive só em memória.
    }
  }

  async function changePhase(id: string, phase: ProjectPhase) {
    const current = effective.find((p) => p.id === id);
    if (!current || current.phase === phase) return;
    setPhaseOverrides((o) => ({ ...o, [id]: phase }));
    const supabase = createClient();
    // .select() força o RLS a aparecer como 0 rows (update bloqueado não erra).
    const { data, error } = await supabase
      .from("Project")
      .update({ phase, updatedAt: new Date().toISOString() })
      .eq("id", id)
      .select("id");
    if (error || !data?.length) {
      setPhaseOverrides((o) => {
        const next = { ...o };
        delete next[id];
        return next;
      });
      showErrorToast(
        new Error(error?.message ?? "Sem permissão pra mover este projeto"),
        { label: "Falha ao mover projeto" },
      );
      return;
    }
    router.refresh();
  }

  // Drawer endereçável: a seleção vive na URL (?project=) — F5 mantém, Back
  // fecha, link compartilha. push abre (entra no histórico); replace fecha e
  // navega entre projetos (não polui o histórico).
  const selectedId = searchParams.get("project");
  function navigate(id: string | null, mode: "push" | "replace") {
    const params = new URLSearchParams(searchParams.toString());
    if (id) params.set("project", id);
    else params.delete("project");
    const qs = params.toString();
    const url = qs ? `?${qs}` : "/";
    if (mode === "push") router.push(url, { scroll: false });
    else router.replace(url, { scroll: false });
  }

  // ProjectOverview não carrega os campos de edição — busca o registro
  // completo sob demanda ao abrir o editor.
  async function openEdit(id: string) {
    const supabase = createClient();
    const { data, error } = await supabase
      .from("Project")
      .select(
        "id, name, repoUrl, startDate, endDate, status, category, phase, engagementType, clientId, pmId, githubRepoOwner, githubRepoName, githubDefaultBranch, projectMembers:ProjectMember(memberId)",
      )
      .eq("id", id)
      .single();
    if (error || !data) {
      showErrorToast(new Error(error?.message ?? "Projeto não encontrado"), {
        label: "Falha ao abrir editor",
      });
      return;
    }
    setEditProject({
      id: data.id,
      name: data.name,
      repoUrl: data.repoUrl,
      startDate: data.startDate,
      endDate: data.endDate,
      status: data.status,
      category: data.category ?? "billable",
      phase: data.phase ?? "ops",
      engagementType: data.engagementType ?? "fixed_scope",
      clientId: data.clientId,
      pmId: data.pmId,
      githubRepoOwner: data.githubRepoOwner,
      githubRepoName: data.githubRepoName,
      githubDefaultBranch: data.githubDefaultBranch,
      memberIds: (data.projectMembers ?? []).map((m: { memberId: string }) => m.memberId),
    });
    setEditOpen(true);
  }

  // Filtros vivem num dropdown no rodapé: internos e testes/eval ficam
  // escondidos por default (foco em projetos de cliente).
  const internalCount = useMemo(
    () => projects.filter((p) => p.category === "internal" && !p.isEval).length,
    [projects],
  );
  const evalCount = useMemo(() => projects.filter((p) => p.isEval).length, [projects]);

  // Ribbon — labels/tooltips/fórmulas do catálogo de métricas (D1): linha
  // ativa = projeto ativo em fase produtiva, sem internos/eval. "Em atenção"
  // é sinal local de health, não métrica do registry.
  const ribbon = useMemo<RibbonItem[]>(() => {
    const universe = effective.filter((p) => p.category !== "internal" && !p.isEval);
    const lines = universe.filter(
      (p) => p.status === "active" && PRODUCING_PHASES.includes(p.phase),
    );
    const buffer = universe.filter(
      (p) => p.status === "active" && p.phase === "commercial",
    ).length;
    const clientes = new Set(lines.map((p) => p.clientName).filter(Boolean)).size;
    const attention = lines.filter((p) => p.health !== "green").length;
    const util = meanOf(lines.map((p) => p.stats.utilizationPct));
    const loadBand =
      factoryLoad.value !== null
        ? bandOf(factoryLoad.value, ui.bands["factory.committed_vs_capacity"] ?? [])
        : null;
    return [
      {
        key: "lines",
        label: ui.names["factory.lines_active"] ?? "Linhas ativas",
        value: String(lines.length),
      },
      {
        key: "buffer",
        label: ui.names["factory.commercial_buffer"] ?? "Em comercial",
        value: String(buffer),
      },
      {
        key: "clients",
        label: ui.names["factory.clients_active"] ?? "Clientes ativos",
        value: String(clientes),
      },
      {
        key: "attention",
        label: "Em atenção",
        value: String(attention),
        tone: attention > 0 ? "amber" : undefined,
      },
      {
        key: "utilization",
        label: ui.names["factory.utilization"] ?? "Aproveitamento da fábrica",
        value: util === null ? "—" : `${Math.round(util)}%`,
      },
      {
        key: "load",
        label: ui.names["factory.committed_vs_capacity"] ?? "Carga da fábrica",
        // Faixa verde fica só na cor (sem sufixo); alerta ganha o nome da faixa.
        value:
          factoryLoad.value === null
            ? "—"
            : `${factoryLoad.value}%${loadBand && loadBand.tone !== "green" ? ` ${loadBand.label}` : ""}`,
        tone:
          loadBand?.tone === "red" || loadBand?.tone === "critical"
            ? "red"
            : loadBand?.tone === "amber"
              ? "amber"
              : undefined,
      },
    ];
  }, [effective, factoryLoad, ui]);

  const grouped = useMemo(() => {
    const visible = effective.filter((p) => {
      if (p.isEval && !showEval) return false;
      if (p.category === "internal" && !showInternal) return false;
      return true;
    });
    return PHASE_ORDER.map((phase) => ({
      phase,
      items: visible.filter((p) => p.phase === phase),
    })).filter((g) => g.items.length > 0);
  }, [effective, showInternal, showEval]);

  // Ordem de navegação ‹ › = ordem visível do board (ignora colapso de grupo).
  const visibleFlat = useMemo(() => grouped.flatMap((g) => g.items), [grouped]);

  const selected = selectedId ? visibleFlat.find((p) => p.id === selectedId) ?? null : null;
  const selectedIndex = selected ? visibleFlat.indexOf(selected) : -1;
  const drawerOpen = !!selected && !editOpen;

  // ← → navegam projetos com o drawer aberto (revisão seriada de segunda).
  useEffect(() => {
    if (!drawerOpen) return;
    function onKey(e: KeyboardEvent) {
      if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
      const target = e.target as HTMLElement | null;
      if (target && /^(input|textarea|select)$/i.test(target.tagName)) return;
      const delta = e.key === "ArrowRight" ? 1 : -1;
      const next = visibleFlat[selectedIndex + delta];
      if (next) {
        e.preventDefault();
        navigate(next.id, "replace");
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [drawerOpen, selectedIndex, visibleFlat]);

  // ↑ ↓ movem o foco entre linhas do board (Enter abre — nativo do button).
  function onRowsKeyDown(e: React.KeyboardEvent) {
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    const rows = Array.from(
      rowsRef.current?.querySelectorAll<HTMLButtonElement>("[data-overview-row]") ?? [],
    );
    const idx = rows.indexOf(document.activeElement as HTMLButtonElement);
    if (idx === -1) return;
    e.preventDefault();
    const next =
      rows[Math.min(Math.max(idx + (e.key === "ArrowDown" ? 1 : -1), 0), rows.length - 1)];
    next?.focus();
  }

  function togglePhase(phase: ProjectPhase) {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(phase)) next.delete(phase);
      else next.add(phase);
      return next;
    });
  }

  if (projects.length === 0) {
    return (
      <div className="surface flex flex-col items-center gap-2 py-12 text-center text-sm text-muted-foreground">
        <FolderKanban className="h-6 w-6" />
        Nenhum projeto ativo.
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {/* Ribbon — leitura de 5 segundos da fábrica; click no KPI expande o
          painel do eixo logo abaixo (padrão SprintRibbon) */}
      <div>
        <OverviewRibbon
          items={ribbon}
          active={ribbonAxis}
          onToggle={(axis) => setRibbonAxis((prev) => (prev === axis ? null : axis))}
        />
        <RibbonPanel
          axis={ribbonAxis}
          projects={effective}
          factoryLoad={factoryLoad}
          builderLoads={builderLoads}
          ui={ui}
          onOpenProject={(id) => navigate(id, "push")}
        />
      </div>

      {/* Projetos por fase (funil) — lista em seções ou kanban em colunas */}
      {grouped.length > 0 && (
        <div ref={rowsRef} onKeyDown={onRowsKeyDown} className="space-y-3">
          <div className="flex justify-end">
            <div className="flex overflow-hidden rounded-md border">
              <button
                type="button"
                onClick={() => switchView("rows")}
                title="Lista por fase"
                className={cn(
                  "flex h-8 items-center gap-1 px-2 text-[11px]",
                  view === "rows"
                    ? "bg-muted text-foreground"
                    : "text-muted-foreground hover:bg-muted/50",
                )}
              >
                <List className="size-3.5" />
                Lista
              </button>
              <button
                type="button"
                onClick={() => switchView("kanban")}
                title="Kanban por fase"
                className={cn(
                  "flex h-8 items-center gap-1 border-l px-2 text-[11px]",
                  view === "kanban"
                    ? "bg-muted text-foreground"
                    : "text-muted-foreground hover:bg-muted/50",
                )}
              >
                <KanbanSquare className="size-3.5" />
                Kanban
              </button>
            </div>
          </div>

          {view === "kanban" ? (
            <ProjetosKanban
              projects={visibleFlat}
              onOpen={(id) => navigate(id, "push")}
              onPhaseChange={changePhase}
            />
          ) : (
            <div className="space-y-4">
              {grouped.map((g) => (
                <section key={g.phase}>
                  <PhaseHeader
                    phase={g.phase}
                    items={g.items}
                    collapsed={collapsed.has(g.phase)}
                    onToggle={() => togglePhase(g.phase)}
                  />
                  {!collapsed.has(g.phase) && (
                    <div className="mt-2 space-y-1.5">
                      {g.items.map((p) => (
                        <ProjectRow
                          key={p.id}
                          p={p}
                          ui={ui}
                          onOpen={() => navigate(p.id, "push")}
                        />
                      ))}
                    </div>
                  )}
                </section>
              ))}
            </div>
          )}
        </div>
      )}

      {grouped.length === 0 && (
        <div className="surface flex flex-col items-center gap-2 py-12 text-center text-sm text-muted-foreground">
          <CheckCircle2 className="h-6 w-6" />
          Nenhum projeto visível. Ajuste os filtros abaixo.
        </div>
      )}

      {/* Filtros — internos + testes/eval, escondidos por default */}
      {(internalCount > 0 || evalCount > 0) && (
        <div className="flex justify-end">
          <DropdownMenu>
            <DropdownMenuTrigger
              render={<Button variant="ghost" size="sm" className="gap-1.5 text-muted-foreground" />}
            >
              <SlidersHorizontal className="h-3.5 w-3.5" />
              Filtros
              {(showInternal || showEval) && (
                <span className="ml-1 rounded bg-primary/15 px-1.5 py-0.5 text-[10px] font-medium text-primary">
                  {(showInternal ? 1 : 0) + (showEval ? 1 : 0)}
                </span>
              )}
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuCheckboxItem
                checked={showInternal}
                onCheckedChange={(v) => setShowInternal(!!v)}
                disabled={internalCount === 0}
              >
                Mostrar internos ({internalCount})
              </DropdownMenuCheckboxItem>
              <DropdownMenuCheckboxItem
                checked={showEval}
                onCheckedChange={(v) => setShowEval(!!v)}
                disabled={evalCount === 0}
              >
                Mostrar testes/eval ({evalCount})
              </DropdownMenuCheckboxItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      )}

      {/* Drawer: desktop side-sheet, mobile bottom-sheet — um codepath só.
          Some enquanto o editor está aberto (nunca 2 overlays; volta ao
          salvar/cancelar porque ?project= continua na URL). */}
      <ResponsiveSheet open={drawerOpen} onOpenChange={(o) => !o && navigate(null, "replace")}>
        <ResponsiveSheetContent size="3xl" expandable>
          {selected && (
            <ProjectDrawer
              p={selected}
              index={selectedIndex}
              total={visibleFlat.length}
              ui={ui}
              onPrev={() => {
                const prev = visibleFlat[selectedIndex - 1];
                if (prev) navigate(prev.id, "replace");
              }}
              onNext={() => {
                const next = visibleFlat[selectedIndex + 1];
                if (next) navigate(next.id, "replace");
              }}
              onEdit={() => openEdit(selected.id)}
            />
          )}
        </ResponsiveSheetContent>
      </ResponsiveSheet>

      <ProjectEditSheet
        open={editOpen}
        onOpenChange={setEditOpen}
        project={editProject}
        onSaved={() => {
          router.refresh();
        }}
      />
    </div>
  );
}
