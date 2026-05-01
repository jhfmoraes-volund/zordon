"use client";

import { useEffect, useMemo } from "react";
import { ChevronLeft, ChevronRight, Locate } from "lucide-react";
import { Button } from "@/components/ui/button";
import { lookupChip, SPRINT_STATUS } from "@/lib/status-chips";
import type { Task } from "@/components/story-hierarchy";
import { sprintFP } from "./helpers";
import type { Sprint } from "./types";

type Props = {
  sprints: Sprint[];
  currentId: string;
  /** Sprint id resolved as "vigente" by `findCurrentSprint`. */
  activeId?: string | null;
  onChange: (id: string) => void;
  onJumpToActive?: () => void;
  /** When true, ←/→ keys navigate between sprints. */
  enableKeyboard?: boolean;
  /** Optional — when provided, meta line shows progress %. */
  tasks?: Task[];
};

const fmt = (d: string) =>
  new Date(d + "T00:00:00").toLocaleDateString("pt-BR", {
    day: "2-digit",
    month: "short",
  });

export function SprintNavigator({
  sprints,
  currentId,
  activeId,
  onChange,
  onJumpToActive,
  enableKeyboard = true,
  tasks,
}: Props) {
  const sorted = useMemo(
    () => [...sprints].sort((a, b) => a.startDate.localeCompare(b.startDate)),
    [sprints],
  );
  const idx = sorted.findIndex((s) => s.id === currentId);
  const prev = idx > 0 ? sorted[idx - 1] : null;
  const next = idx >= 0 && idx < sorted.length - 1 ? sorted[idx + 1] : null;
  const current = idx >= 0 ? sorted[idx] : null;

  useEffect(() => {
    if (!enableKeyboard) return;
    const handler = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.isContentEditable)
      ) {
        return;
      }
      if (e.key === "ArrowLeft" && prev) {
        e.preventDefault();
        onChange(prev.id);
      } else if (e.key === "ArrowRight" && next) {
        e.preventDefault();
        onChange(next.id);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [prev, next, onChange, enableKeyboard]);

  if (!current) return null;

  const status = lookupChip(SPRINT_STATUS, current.status);
  const fp = tasks ? sprintFP(current.id, tasks) : null;
  const pct = fp && fp.total > 0 ? Math.round((fp.done / fp.total) * 100) : null;
  const isViewingActive = activeId && current.id === activeId;

  return (
    <div className="relative flex items-center gap-2 rounded-xl border bg-muted/30 px-2 py-2 md:px-3">
      <Button
        size="icon-sm"
        variant="ghost"
        disabled={!prev}
        onClick={() => prev && onChange(prev.id)}
        aria-label="Sprint anterior"
        title={prev ? `Anterior · ${prev.name}` : "Sem sprint anterior"}
        className="shrink-0 text-muted-foreground hover:text-foreground"
      >
        <ChevronLeft />
      </Button>

      <div className="flex min-w-0 flex-1 items-center justify-center gap-2 md:gap-3">
        <h2 className="truncate text-sm font-semibold tracking-tight md:text-base">
          {current.name}
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
          {fmt(current.startDate)} → {fmt(current.endDate)}
        </span>
        {pct !== null ? (
          <>
            <span aria-hidden className="hidden text-muted-foreground/50 md:inline">·</span>
            <span className="hidden font-mono text-xs tabular-nums text-muted-foreground md:inline">
              {pct}%
            </span>
          </>
        ) : null}
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
        disabled={!next}
        onClick={() => next && onChange(next.id)}
        aria-label="Próximo sprint"
        title={next ? `Próximo · ${next.name}` : "Sem próximo sprint"}
        className="shrink-0 text-muted-foreground hover:text-foreground"
      >
        <ChevronRight />
      </Button>
    </div>
  );
}
