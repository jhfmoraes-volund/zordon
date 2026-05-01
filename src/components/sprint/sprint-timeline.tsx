"use client";

import { useMemo } from "react";
import { StatusChip } from "@/components/ui/status-chip";
import { lookupChip, SPRINT_STATUS } from "@/lib/status-chips";
import type { Task } from "@/components/story-hierarchy";
import { sprintFP } from "./helpers";
import type { Sprint } from "./types";

type Props = {
  sprints: Sprint[];
  tasks: Task[];
  /** Highlights this sprint (current/vigente). */
  activeId?: string | null;
  /** When clicked, navigates / informs. */
  onSelect?: (sprintId: string) => void;
  /** Compact card width — default 180px. */
  cardWidth?: number;
};

const fmt = (d: string) =>
  new Date(d + "T00:00:00").toLocaleDateString("pt-BR", {
    day: "2-digit",
    month: "short",
  });

export function SprintTimeline({
  sprints,
  tasks,
  activeId,
  onSelect,
  cardWidth = 180,
}: Props) {
  const sorted = useMemo(
    () => [...sprints].sort((a, b) => a.startDate.localeCompare(b.startDate)),
    [sprints],
  );

  if (sorted.length === 0) {
    return (
      <p className="text-xs text-muted-foreground">
        Nenhum sprint cadastrado.
      </p>
    );
  }

  return (
    <div className="overflow-x-auto pb-2">
      <div className="flex gap-2">
        {sorted.map((s) => {
          const fp = sprintFP(s.id, tasks);
          const pct = fp.total > 0 ? Math.round((fp.done / fp.total) * 100) : 0;
          const isActive = activeId === s.id;
          return (
            <button
              key={s.id}
              type="button"
              onClick={() => onSelect?.(s.id)}
              style={{ minWidth: cardWidth }}
              className={`flex shrink-0 flex-col gap-1.5 rounded-lg border p-2.5 text-left transition-colors hover:bg-muted/40 ${
                isActive
                  ? "border-primary bg-primary/5 ring-1 ring-primary/30"
                  : ""
              }`}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="truncate text-xs font-semibold">{s.name}</span>
                <StatusChip {...lookupChip(SPRINT_STATUS, s.status)} />
              </div>
              <div className="font-mono text-[10px] tabular-nums text-muted-foreground">
                {fmt(s.startDate)} → {fmt(s.endDate)}
              </div>
              <div className="flex items-center justify-between text-[11px]">
                <span className="font-mono tabular-nums text-muted-foreground">
                  {fp.done}/{fp.total} FP
                </span>
                <span className="font-mono tabular-nums font-medium">
                  {pct}%
                </span>
              </div>
              <div className="h-1 overflow-hidden rounded-full bg-muted">
                <div
                  className="h-full bg-primary transition-[width]"
                  style={{ width: `${pct}%` }}
                />
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
