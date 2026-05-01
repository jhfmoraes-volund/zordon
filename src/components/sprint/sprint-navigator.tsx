"use client";

import { useEffect, useMemo } from "react";
import { ChevronLeft, ChevronRight, Locate } from "lucide-react";
import { Button } from "@/components/ui/button";
import { StatusChip } from "@/components/ui/status-chip";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { lookupChip, SPRINT_STATUS } from "@/lib/status-chips";
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

  const isViewingActive = activeId && current.id === activeId;

  return (
    <div className="flex items-center gap-2 rounded-xl border bg-muted/30 p-2 md:gap-3 md:p-3">
      <Button
        size="icon-sm"
        variant="outline"
        disabled={!prev}
        onClick={() => prev && onChange(prev.id)}
        aria-label="Sprint anterior"
        title={prev ? `Anterior · ${prev.name}` : "Sem sprint anterior"}
      >
        <ChevronLeft />
      </Button>

      <div className="flex min-w-0 flex-1 items-center gap-2">
        <h2 className="truncate text-base font-semibold">{current.name}</h2>
        <StatusChip
          {...lookupChip(SPRINT_STATUS, current.status)}
          dot
          className="hidden md:inline-flex"
        />
        <span className="hidden font-mono text-xs tabular-nums text-muted-foreground md:inline">
          {fmt(current.startDate)} → {fmt(current.endDate)}
        </span>
        {isViewingActive ? (
          <span className="hidden rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-primary md:inline">
            vigente
          </span>
        ) : null}
      </div>

      <Select value={currentId} onValueChange={(v) => v && onChange(v)}>
        <SelectTrigger className="h-8 w-[110px] text-xs md:w-[140px]">
          <SelectValue>
            {(v: string | null) =>
              v ? sorted.find((s) => s.id === v)?.name ?? "—" : "—"
            }
          </SelectValue>
        </SelectTrigger>
        <SelectContent>
          {sorted.map((s) => (
            <SelectItem key={s.id} value={s.id}>
              <span className="flex items-center gap-2">
                <span>{s.name}</span>
                {activeId === s.id ? (
                  <span className="text-[10px] text-primary">●</span>
                ) : null}
              </span>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {activeId && currentId !== activeId && onJumpToActive ? (
        <Button
          size="sm"
          variant="ghost"
          onClick={onJumpToActive}
          aria-label="Ir pro sprint vigente"
        >
          <Locate className="size-3.5" />
          <span className="hidden md:inline">Ir pro vigente</span>
        </Button>
      ) : null}

      <Button
        size="icon-sm"
        variant="outline"
        disabled={!next}
        onClick={() => next && onChange(next.id)}
        aria-label="Próximo sprint"
        title={next ? `Próximo · ${next.name}` : "Sem próximo sprint"}
      >
        <ChevronRight />
      </Button>
    </div>
  );
}
