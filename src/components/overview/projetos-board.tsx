"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import {
  AlertTriangle,
  ArrowUpRight,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  FolderKanban,
  Pencil,
  SlidersHorizontal,
} from "lucide-react";
import {
  ResponsiveSheet,
  ResponsiveSheetContent,
  ResponsiveSheetHeader,
  ResponsiveSheetTitle,
  ResponsiveSheetBody,
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
} from "@/lib/dal/project-overview";
import type { Threshold } from "@/lib/metrics/types";

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
  /** thresholds de project.pace_gap — PaceBadge deriva label/tom daqui. */
  paceBands: Threshold[];
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

const HEALTH_RANK: Record<ProjectHealth, number> = { red: 0, amber: 1, green: 2 };

/** Tom do registry → classe de texto (labels/faixas vêm de RegistryUi.paceBands). */
const TONE_CLS: Record<Threshold["tone"], string> = {
  green: "text-emerald-500",
  amber: "text-yellow-500",
  red: "text-red-400",
  critical: "text-red-400",
};

/** 1ª faixa (ordem decrescente de gte) onde o gap cai; gte null = catch-all. */
function paceBand(gap: number, bands: Threshold[]): Threshold | null {
  return bands.find((b) => b.gte === null || gap >= b.gte) ?? null;
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

/** Sinais do card compacto como chips ("3 riscos", "2 paradas") — sem frase. */
function signalChips(p: ProjectOverview): Array<{ label: string; tone: ChipTone }> {
  const chips: Array<{ label: string; tone: ChipTone }> = [];
  const { overdue, blocked, unassigned } = p.signals;
  const risks = p.pmReview?.notesByKind.risk?.length ?? 0;
  if (overdue > 0) chips.push({ label: `${overdue} vencida${overdue > 1 ? "s" : ""}`, tone: "red" });
  if (risks > 0) chips.push({ label: `${risks} risco${risks > 1 ? "s" : ""}`, tone: "red" });
  if (blocked > 0) chips.push({ label: `${blocked} parada${blocked > 1 ? "s" : ""}`, tone: "amber" });
  if (unassigned > 0) chips.push({ label: `${unassigned} sem dono`, tone: "amber" });
  return chips;
}

/** Chip do próximo marco — tom por proximidade (passou=red, ≤14d=amber). */
function milestoneChip(p: ProjectOverview): { label: string; tone: ChipTone } | null {
  if (!p.milestone) return null;
  const due = new Date(`${p.milestone.dueAt}T00:00:00`);
  const days = Math.ceil((due.getTime() - Date.now()) / 86400000);
  const tone: ChipTone = days < 0 ? "red" : days <= 14 ? "amber" : "slate";
  return { label: `${p.milestone.label} · ${fmtDate(due)}`, tone };
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

/** Estado visual da célula — semana é unidade atômica: produziu / desligada / corrente / futura. */
function cellClass(g: ProjectStats["segments"][number]): string {
  if (g.kind === "closed") return segmentColor(g.deliveryPct);
  if (g.kind === "hole") return "border border-dashed border-muted-foreground/30 bg-transparent";
  if (g.kind === "current")
    return g.sprintId
      ? "bg-primary/30 ring-1 ring-inset ring-primary/70"
      : "bg-transparent ring-1 ring-inset ring-yellow-500/70";
  return "bg-muted/50"; // future
}

/**
 * A régua: uma CÉLULA ATÔMICA por sprint do contrato (ou por sprint, em
 * rolling) — largura fixa, alinhada à esquerda; contrato longo quebra linha.
 * Célula acesa = produção real (cor = entrega); apagada tracejada = sprint do
 * contrato desligada (sem produção). Pista não-cromática: texto "5/12" sempre
 * ao lado + tooltip por célula. Legenda: ReguaLegend (drawer).
 */
function Regua({ stats, size = "sm" }: { stats: ProjectStats; size?: "sm" | "lg" }) {
  if (stats.segments.length === 0) return null;
  const lg = size === "lg";
  // ⚑ só no drawer: na linha do board ele variaria a altura entre rows
  // (jitter de ritmo vertical) e o chip do marco já vive na própria linha.
  const milestoneIdx = lg ? stats.milestoneIndex : null;
  return (
    <div
      title="1 bloco = 1 sprint do contrato · cor = entrega real"
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

/** Legenda da régua — só no drawer; o board explica por tooltip. */
function ReguaLegend({ contract }: { contract: boolean }) {
  const sw = "inline-block h-2 w-3 shrink-0 rounded-[3px]";
  return (
    <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] text-muted-foreground">
      {contract && <span className="font-medium">1 bloco = 1 sprint do contrato</span>}
      <span className="flex items-center gap-1">
        <i className={cn(sw, "bg-emerald-500/70")} /> entregue
      </span>
      <span className="flex items-center gap-1">
        <i className={cn(sw, "bg-yellow-500/60")} /> parcial
      </span>
      <span className="flex items-center gap-1">
        <i className={cn(sw, "bg-red-400/70")} /> baixa
      </span>
      <span className="flex items-center gap-1">
        <i className={cn(sw, "border border-dashed border-muted-foreground/40")} /> desligada
      </span>
      <span className="flex items-center gap-1">
        <i className={cn(sw, "bg-primary/30 ring-1 ring-inset ring-primary/70")} /> corrente
      </span>
      <span className="flex items-center gap-1">
        <i className={cn(sw, "bg-muted/50")} /> futura
      </span>
    </div>
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
  if (stats.paceGapPp === null) return null;
  const band = paceBand(stats.paceGapPp, bands);
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

/** Linha de stats compacta sob a régua (posição · pace · ritmo). */
function RowStatsLine({ p, ui }: { p: ProjectOverview; ui: RegistryUi }) {
  const s = p.stats;
  if (s.mode === "contract") {
    return (
      <div className="flex flex-wrap items-center justify-end gap-x-3 gap-y-0.5 text-[11px] tabular-nums text-muted-foreground">
        <span
          className="cursor-help font-medium text-foreground"
          title={ui.defenses["project.sprints_elapsed"]}
        >
          {s.weeksElapsed}/{s.weeksTotal}
        </span>
        <PaceBadge stats={s} bands={ui.paceBands} hint={ui.defenses["project.pace_gap"]} />
        {s.avgFpPerSprint !== null && (
          <span
            className="hidden cursor-help md:inline"
            title={ui.defenses["project.avg_fp_per_sprint"]}
          >
            {fmtAvg(s.avgFpPerSprint)}
          </span>
        )}
        {s.holes > 0 && (
          <span className="cursor-help text-yellow-500" title={ui.defenses["project.holes"]}>
            {s.holes} sem sprint
          </span>
        )}
      </div>
    );
  }
  if (s.mode === "rolling") {
    return (
      <div className="flex flex-wrap items-center justify-end gap-x-3 gap-y-0.5 text-[11px] tabular-nums text-muted-foreground">
        <span>últimas {s.segments.length} sprints</span>
        {s.avgFpPerSprint !== null && (
          <span
            className="cursor-help font-medium text-foreground"
            title={ui.defenses["project.avg_fp_per_sprint"]}
          >
            {fmtAvg(s.avgFpPerSprint)}
          </span>
        )}
        {s.utilizationPct !== null && (
          <span className="hidden cursor-help md:inline" title={ui.defenses["project.utilization"]}>
            aprov. {s.utilizationPct}%
          </span>
        )}
      </div>
    );
  }
  return null;
}

// ─── Ribbon do topo ───────────────────────────────────────

type RibbonItem = {
  label: string;
  value: string;
  hint?: string;
  tone?: "amber" | "red";
};

/** Banda fina de KPIs da fábrica — valor herói, label apagado, tabular-nums. */
function OverviewRibbon({ items }: { items: RibbonItem[] }) {
  return (
    <div className="flex flex-wrap items-stretch gap-y-3 border-y border-border py-3">
      {items.map((item, i) => (
        <div
          key={item.label}
          title={item.hint}
          className={cn(
            "flex min-w-0 flex-col gap-0.5 pr-5",
            i > 0 && "border-l border-border pl-5",
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
          <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
            {item.label}
          </span>
        </div>
      ))}
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
  const chips = signalChips(p);
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
          {chips.slice(0, 2).map((c) => (
            <StatusChip key={c.label} label={c.label} tone={c.tone} variant="subtle" size="sm" />
          ))}
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

/**
 * Slot Panorama — narrativa da semana (summary + rumo fundidos), texto
 * integral. O drawer é a camada de leitura: truncar aqui forçaria um 4º
 * nível de clique — quem precisa de menos texto resolve na origem (Vitoria).
 */
function PanoramaCard({ notes }: { notes: Record<string, PMReviewNoteLite[]> }) {
  const summary = notes.summary?.[0]?.content;
  const direction = notes.project_direction?.[0]?.content;
  return (
    <div className="surface-inset p-3">
      <h5 className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
        Panorama
      </h5>
      {!summary && !direction ? (
        <p className="mt-1.5 text-xs text-muted-foreground">Sem panorama esta semana.</p>
      ) : (
        <div className="mt-1.5 space-y-1.5">
          {summary && <p className="text-sm leading-relaxed">{summary}</p>}
          {direction && (
            <p className="text-xs leading-relaxed text-muted-foreground">
              <span className="text-[10px] font-medium uppercase tracking-wide">Rumo</span>{" "}
              {direction}
            </p>
          )}
        </div>
      )}
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
  return (
    <div className="surface-inset p-3">
      <h5 className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
        {title}
        {items.length > 0 && <span className="font-normal"> ({items.length})</span>}
      </h5>
      {items.length === 0 ? (
        <p className="mt-1.5 text-xs text-muted-foreground">{emptyText}</p>
      ) : (
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
      )}
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
        // o clamp de 2 linhas segura a ideia completa, fonte maior.
        <div className="space-y-2">
          <PanoramaCard notes={digest} />
          <DigestCard title="Riscos" items={digest.risk ?? []} emptyText="Sem riscos esta semana." />
          <DigestCard
            title="Próximos passos"
            items={digest.next_step ?? []}
            emptyText="Sem próximos passos."
          />
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
 * Tooltip de defesa (D6) no drawer — Base UI abre por hover/focus, então o
 * trigger focável cobre tap no mobile (title nativo não cobre).
 */
function StatTip({ hint, children }: { hint?: string; children: React.ReactNode }) {
  if (!hint) return <>{children}</>;
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <span
            tabIndex={0}
            className="cursor-help rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
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
  const body = (
    <>
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
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
    </>
  );
  if (!hint) return <div className="min-w-0">{body}</div>;
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <div
            tabIndex={0}
            className="min-w-0 cursor-help rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
        }
      >
        {body}
      </TooltipTrigger>
      <TooltipContent>{hint}</TooltipContent>
    </Tooltip>
  );
}

/**
 * Dossiê de STATS: régua grande + PRAZO / ENTREGA / RITMO + projeção.
 * Fórmulas: docs/features/overview/stats-dictionary.md (gerado do registry).
 */
function StatsSection({ p, ui }: { p: ProjectOverview; ui: RegistryUi }) {
  const s = p.stats;
  const producing = PRODUCING_PHASES.includes(p.phase);

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

  const projectionDelta =
    s.projectedEndWeek !== null && s.weeksTotal !== null ? s.projectedEndWeek - s.weeksTotal : null;

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

        <Regua stats={s} size="lg" />
        <ReguaLegend contract={s.mode === "contract"} />

        <div className="mt-3 grid grid-cols-3 gap-3">
          {s.mode === "contract" ? (
            <>
              <StatCol
                label="Contrato"
                value={`sprint ${s.weeksElapsed}/${s.weeksTotal}`}
                sub={`${s.timePct}% do contrato consumido`}
                hint={ui.defenses["project.time_pct"]}
              />
              <StatCol
                label="Entrega"
                value={`${s.sprintsClosed} fechada${s.sprintsClosed === 1 ? "" : "s"}`}
                sub={
                  s.scopePct !== null
                    ? `${s.scopePct}% do escopo (${s.fpDone}/${s.fpTotal} FP)`
                    : "sem FP estimado"
                }
                hint={ui.defenses["project.scope_pct"] ?? ui.defenses["project.sprints_closed"]}
              />
              <StatCol
                label="Ritmo"
                value={fmtAvg(s.avgFpPerSprint)}
                sub={
                  s.utilizationPct !== null
                    ? `aproveitamento ${s.utilizationPct}%`
                    : "ritmo das últimas 6 sprints fechadas"
                }
                hint={ui.defenses["project.avg_fp_per_sprint"]}
              />
            </>
          ) : (
            <>
              <StatCol
                label="Janela"
                value={`${s.segments.length} sprints`}
                sub="contínuo — sem prazo"
              />
              <StatCol
                label="Entrega"
                value={`${s.sprintsClosed} fechada${s.sprintsClosed === 1 ? "" : "s"}`}
                sub={
                  s.scopePct !== null
                    ? `${s.scopePct}% do escopo (${s.fpDone}/${s.fpTotal} FP)`
                    : "sem FP estimado"
                }
                hint={ui.defenses["project.scope_pct"] ?? ui.defenses["project.sprints_closed"]}
              />
              <StatCol
                label="Ritmo"
                value={fmtAvg(s.avgFpPerSprint)}
                sub={
                  s.utilizationPct !== null
                    ? `aproveitamento ${s.utilizationPct}%`
                    : "ritmo das últimas 6 sprints fechadas"
                }
                hint={ui.defenses["project.avg_fp_per_sprint"]}
              />
            </>
          )}
        </div>

        {(s.paceVerdict !== null || projectionDelta !== null || s.holes > 0) && (
          <div className="mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] tabular-nums text-muted-foreground">
            <StatTip hint={ui.defenses["project.pace_gap"]}>
              <PaceBadge stats={s} bands={ui.paceBands} />
            </StatTip>
            {s.projectedEndWeek !== null && projectionDelta !== null && (
              <StatTip hint={ui.defenses["project.projected_end_sprint"]}>
                <span className={cn(projectionDelta > 0 && "text-red-400")}>
                  ◆ projeção: termina na sprint {s.projectedEndWeek}
                  {projectionDelta > 0
                    ? ` (${projectionDelta} além do contrato)`
                    : projectionDelta < 0
                      ? ` (${Math.abs(projectionDelta)} antes do fim)`
                      : " (no limite do contrato)"}
                </span>
              </StatTip>
            )}
            {s.holes > 0 && (
              <StatTip hint={ui.defenses["project.holes"]}>
                <span className="text-yellow-500">
                  {s.holes} sprint{s.holes > 1 ? "s" : ""} do contrato queimada
                  {s.holes > 1 ? "s" : ""} sem produção
                </span>
              </StatTip>
            )}
          </div>
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
  const milestone = milestoneChip(p);
  return (
    <>
      <ResponsiveSheetHeader>
        {/* Linha utilitária: navegação seriada à esquerda, ações à direita */}
        <div className="mr-8 flex items-center gap-1.5 text-xs tabular-nums text-muted-foreground">
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
          {milestone && (
            <StatusChip label={milestone.label} tone={milestone.tone} variant="subtle" size="sm" />
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
  buildersAllocated,
  registryUi: ui,
}: {
  projects: ProjectOverview[];
  /** factory.builders_allocated computado no server (DAL capacity). */
  buildersAllocated: { allocated: number; total: number };
  /** Vocabulário do registry (names/defenses/paceBands), resolvido no server. */
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
    const universe = projects.filter((p) => p.category !== "internal" && !p.isEval);
    const lines = universe.filter(
      (p) => p.status === "active" && PRODUCING_PHASES.includes(p.phase),
    );
    const clientes = new Set(lines.map((p) => p.clientName).filter(Boolean)).size;
    const attention = lines.filter((p) => p.health !== "green").length;
    const util = meanOf(lines.map((p) => p.stats.utilizationPct));
    return [
      {
        label: ui.names["factory.lines_active"] ?? "Linhas ativas",
        value: String(lines.length),
        hint: ui.defenses["factory.lines_active"],
      },
      {
        label: ui.names["factory.clients_active"] ?? "Clientes ativos",
        value: String(clientes),
        hint: ui.defenses["factory.clients_active"],
      },
      {
        label: "Em atenção",
        value: String(attention),
        tone: attention > 0 ? "amber" : undefined,
        hint: "Linhas ativas com health diferente de verde (sinal local)",
      },
      {
        label: ui.names["factory.utilization"] ?? "Aproveitamento da fábrica",
        value: util === null ? "—" : `${Math.round(util)}%`,
        hint: ui.defenses["factory.utilization"],
      },
      {
        label: ui.names["factory.builders_allocated"] ?? "Builders alocados",
        value: `${buildersAllocated.allocated}/${buildersAllocated.total}`,
        hint: ui.defenses["factory.builders_allocated"],
      },
    ];
  }, [projects, buildersAllocated, ui]);

  const grouped = useMemo(() => {
    const visible = projects.filter((p) => {
      if (p.isEval && !showEval) return false;
      if (p.category === "internal" && !showInternal) return false;
      return true;
    });
    return PHASE_ORDER.map((phase) => ({
      phase,
      items: visible.filter((p) => p.phase === phase),
    })).filter((g) => g.items.length > 0);
  }, [projects, showInternal, showEval]);

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
      {/* Ribbon — leitura de 5 segundos da fábrica */}
      <OverviewRibbon items={ribbon} />

      {/* Linhas de produção agrupadas por fase (funil), Pai sticky */}
      {grouped.length > 0 && (
        <div ref={rowsRef} onKeyDown={onRowsKeyDown} className="space-y-4">
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
        <ResponsiveSheetContent size="lg">
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
