"use client";

import { useEffect, useMemo } from "react";
import {
  ChevronLeft,
  ChevronRight,
  Inbox,
  List,
  Locate,
  type LucideIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { lookupChip, SPRINT_STATUS } from "@/lib/status-chips";
import type { Task } from "@/components/story-hierarchy";
import { sprintFP } from "./helpers";
import type { Sprint } from "./types";

/** Ids reservados para views sintéticas (não-sprint) no carrossel. */
export type SyntheticViewId = "backlog" | "all";

/** Carrossel value: id de sprint real OU id de view sintética. */
export type NavValue = string | SyntheticViewId;

const SYNTHETIC_VIEWS: Array<{ id: SyntheticViewId; icon: LucideIcon; label: string }> = [
  { id: "backlog", icon: Inbox, label: "Backlog" },
  { id: "all", icon: List, label: "Todas" },
];

type Props = {
  sprints: Sprint[];
  /** Id da sprint focada OU 'backlog' / 'all'. */
  currentId: NavValue;
  /** Sprint id resolved as "vigente" by `findCurrentSprint`. */
  activeId?: string | null;
  onChange: (id: NavValue) => void;
  onJumpToActive?: () => void;
  /** When true, ←/→ keys navigate between sprints. */
  enableKeyboard?: boolean;
  /** Optional — when provided, meta line shows progress %. */
  tasks?: Task[];
  /** Counts to show inside the synthetic view pills. */
  backlogCount?: number;
  allCount?: number;
  /**
   * Mostra pills "Backlog" / "Todas" à direita e inclui as views no ciclo
   * de navegação ←/→. Default: false (consumidores antigos seguem só com sprints).
   */
  showSyntheticViews?: boolean;
};

const fmt = (d: string) =>
  new Date(d + "T00:00:00").toLocaleDateString("pt-BR", {
    day: "2-digit",
    month: "short",
  });

function isSyntheticId(id: NavValue): id is SyntheticViewId {
  return id === "backlog" || id === "all";
}

export function SprintNavigator({
  sprints,
  currentId,
  activeId,
  onChange,
  onJumpToActive,
  enableKeyboard = true,
  tasks,
  backlogCount,
  allCount,
  showSyntheticViews = false,
}: Props) {
  const sortedSprints = useMemo(
    () => [...sprints].sort((a, b) => a.startDate.localeCompare(b.startDate)),
    [sprints],
  );

  // Sequência completa do carrossel: sprints reais (ordenadas) + views sintéticas
  // (apenas quando habilitadas). Setas ←/→ navegam por toda a sequência.
  const sequence: NavValue[] = useMemo(
    () => [
      ...sortedSprints.map((s) => s.id),
      ...(showSyntheticViews ? SYNTHETIC_VIEWS.map((v) => v.id) : []),
    ],
    [sortedSprints, showSyntheticViews],
  );

  const idx = sequence.findIndex((v) => v === currentId);
  const prev = idx > 0 ? sequence[idx - 1] : null;
  const next = idx >= 0 && idx < sequence.length - 1 ? sequence[idx + 1] : null;

  const currentSprint = isSyntheticId(currentId)
    ? null
    : sortedSprints.find((s) => s.id === currentId) ?? null;
  const currentSynthetic = isSyntheticId(currentId)
    ? SYNTHETIC_VIEWS.find((v) => v.id === currentId) ?? null
    : null;

  useEffect(() => {
    if (!enableKeyboard) return;
    const handler = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (!target) return;
      if (
        target.tagName === "INPUT" ||
        target.tagName === "TEXTAREA" ||
        target.isContentEditable
      ) {
        return;
      }
      // Ignora setas quando o foco está dentro de um menu/popover/dialog —
      // ArrowRight num DropdownMenu (e.g., kebab da sprint) sem submenu vira
      // no-op no menu, mas o listener global aqui pegava o evento e mudava
      // a sprint focada (na última sprint, isso pula pra "backlog").
      if (
        target.closest(
          "[role='menu'],[role='menuitem'],[role='dialog'],[role='alertdialog'],[role='listbox'],[role='combobox'],[data-slot='select-content'],[data-slot='dropdown-menu-content']",
        )
      ) {
        return;
      }
      if (e.key === "ArrowLeft" && prev !== null) {
        e.preventDefault();
        onChange(prev);
      } else if (e.key === "ArrowRight" && next !== null) {
        e.preventDefault();
        onChange(next);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [prev, next, onChange, enableKeyboard]);

  // Sem sprint nem view sintética válida — nada pra renderizar.
  if (!currentSprint && !currentSynthetic) return null;

  // ─── Conteúdo do "miolo" do navigator ───────────────────────────────────────
  let centerNode: React.ReactNode;
  if (currentSprint) {
    const status = lookupChip(SPRINT_STATUS, currentSprint.status);
    const fp = tasks ? sprintFP(currentSprint.id, tasks) : null;
    const pct = fp && fp.total > 0 ? Math.round((fp.done / fp.total) * 100) : null;
    const isViewingActive = activeId && currentSprint.id === activeId;
    centerNode = (
      <>
        <h2 className="truncate text-sm font-semibold tracking-tight md:text-base">
          {currentSprint.name}
        </h2>
        <span aria-hidden className="text-muted-foreground/50">·</span>
        <span
          className={`text-xs font-medium ${
            isViewingActive ? "text-primary" : "text-muted-foreground"
          }`}
        >
          {status.label}
        </span>
        <span aria-hidden className="hidden text-muted-foreground/50 sm:inline">·</span>
        <span className="hidden font-mono text-xs tabular-nums text-muted-foreground sm:inline">
          {fmt(currentSprint.startDate)} → {fmt(currentSprint.endDate)}
        </span>
        {pct !== null ? (
          <>
            <span aria-hidden className="hidden text-muted-foreground/50 md:inline">·</span>
            <span className="hidden font-mono text-xs tabular-nums text-muted-foreground md:inline">
              {pct}%
            </span>
          </>
        ) : null}
      </>
    );
  } else if (currentSynthetic) {
    const Icon = currentSynthetic.icon;
    const count =
      currentSynthetic.id === "backlog" ? backlogCount : allCount;
    centerNode = (
      <>
        <Icon className="size-4 text-muted-foreground" aria-hidden />
        <h2 className="truncate text-sm font-semibold tracking-tight md:text-base">
          {currentSynthetic.label}
        </h2>
        {typeof count === "number" ? (
          <>
            <span aria-hidden className="text-muted-foreground/50">·</span>
            <span className="font-mono text-xs tabular-nums text-muted-foreground">
              {count} task{count === 1 ? "" : "s"}
            </span>
          </>
        ) : null}
      </>
    );
  }

  // ─── Pills de view sintética (renderizadas só quando habilitado) ──────────
  const syntheticPills = !showSyntheticViews ? null : (
    <div className="flex shrink-0 items-center gap-1 border-l border-border/60 pl-2">
      {SYNTHETIC_VIEWS.map((v) => {
        const Icon = v.icon;
        const active = currentId === v.id;
        const count = v.id === "backlog" ? backlogCount : allCount;
        return (
          <Button
            key={v.id}
            size="sm"
            variant={active ? "secondary" : "ghost"}
            onClick={() => onChange(v.id)}
            aria-pressed={active}
            aria-label={v.label}
            title={v.label}
            className="h-7 gap-1 px-2 text-xs"
          >
            <Icon className="size-3.5" />
            <span className="hidden sm:inline">{v.label}</span>
            {typeof count === "number" ? (
              <span className="font-mono tabular-nums text-muted-foreground">
                {count}
              </span>
            ) : null}
          </Button>
        );
      })}
    </div>
  );

  return (
    <div className="relative flex items-center gap-2 rounded-xl border bg-muted/30 px-2 py-2 md:px-3">
      <Button
        size="icon-sm"
        variant="ghost"
        disabled={prev === null}
        onClick={() => prev !== null && onChange(prev)}
        aria-label="Anterior"
        className="shrink-0 text-muted-foreground hover:text-foreground"
      >
        <ChevronLeft />
      </Button>

      <div className="flex min-w-0 flex-1 items-center justify-center gap-2 md:gap-3">
        {centerNode}
      </div>

      {activeId && currentId !== activeId && onJumpToActive ? (
        <Button
          size="sm"
          variant="ghost"
          onClick={onJumpToActive}
          aria-label="Ir pro sprint vigente"
          className="shrink-0 gap-1 text-xs text-muted-foreground hover:text-foreground"
        >
          <Locate className="size-3.5" />
          <span className="hidden md:inline">Ir pro vigente</span>
        </Button>
      ) : null}

      <Button
        size="icon-sm"
        variant="ghost"
        disabled={next === null}
        onClick={() => next !== null && onChange(next)}
        aria-label="Próximo"
        className="shrink-0 text-muted-foreground hover:text-foreground"
      >
        <ChevronRight />
      </Button>

      {syntheticPills}
    </div>
  );
}
