"use client";

import { useCallback, useMemo, useState } from "react";
import { ChevronDown } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { StatusChip } from "@/components/ui/status-chip";
import { TaskSheetByRef } from "@/components/task-sheet-by-ref";
import type { BoardTask } from "./use-planning-canvas-data";
import { formatSprintWeek, statusChip } from "./planning-proposal-helpers";

const NONE_KEY = "__none__";

type SprintGroup = {
  sprintId: string | null;
  sprintName: string | null;
  sprintStartDate: string | null;
  sprintEndDate: string | null;
  tasks: BoardTask[];
};

/**
 * Lente "Tasks" do canvas do Planning — RETRATO do que está aplicado: o board
 * vivo (todas as tasks reais do projeto), agrupado por sprint (linha colapsável).
 * Sem propostas/staging — essas vivem na lente "Propostas". Click numa task →
 * TaskSheetByRef (edição rica). Os dados vêm do hook usePlanningCanvasData.
 */
export function ReleasePlanningBoard({
  boardTasks,
  onReload,
}: {
  boardTasks: BoardTask[];
  onReload: () => void;
}) {
  const [openTaskId, setOpenTaskId] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  const toggleCollapse = useCallback((key: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  const groups = useMemo<SprintGroup[]>(() => {
    const map = new Map<string, SprintGroup>();
    for (const t of boardTasks) {
      const key = t.sprintId ?? NONE_KEY;
      let g = map.get(key);
      if (!g) {
        g = {
          sprintId: t.sprintId,
          sprintName: t.sprintName,
          sprintStartDate: t.sprintStartDate,
          sprintEndDate: t.sprintEndDate,
          tasks: [],
        };
        map.set(key, g);
      }
      g.tasks.push(t);
    }
    return Array.from(map.values()).sort((a, b) => {
      if (a.sprintId === null) return 1;
      if (b.sprintId === null) return -1;
      return (a.sprintName ?? "").localeCompare(b.sprintName ?? "", undefined, {
        numeric: true,
      });
    });
  }, [boardTasks]);

  if (boardTasks.length === 0) return null;

  return (
    <div>
      {groups.map((g) => {
        const key = g.sprintId ?? NONE_KEY;
        const isCollapsed = collapsed.has(key);
        const week = formatSprintWeek(g.sprintStartDate, g.sprintEndDate);
        const fpTotal = g.tasks.reduce((sum, t) => sum + (t.functionPoints ?? 0), 0);
        return (
          <section key={key} className="border-t first:border-t-0">
            <button
              type="button"
              onClick={() => toggleCollapse(key)}
              aria-expanded={!isCollapsed}
              className="flex w-full items-center gap-2 border-b bg-muted px-3 py-2 text-left hover:bg-muted/70"
            >
              <ChevronDown
                className={`size-3.5 shrink-0 text-muted-foreground transition-transform ${isCollapsed ? "-rotate-90" : ""}`}
              />
              <span className="text-xs font-semibold uppercase tracking-wide text-foreground">
                {g.sprintName ?? "Sem sprint"}
              </span>
              {week && (
                <Badge variant="outline" className="font-normal">
                  {week}
                </Badge>
              )}
              <span className="ml-auto font-mono text-xs text-muted-foreground">
                {g.tasks.length} task{g.tasks.length === 1 ? "" : "s"} · {fpTotal} PFV
              </span>
            </button>

            {!isCollapsed &&
              g.tasks.map((t) => {
                const chip = statusChip(t.status);
                return (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => setOpenTaskId(t.id)}
                    className="flex w-full flex-col gap-1 px-3 py-2 text-left hover:bg-accent/40"
                  >
                    <div className="flex w-full items-start gap-2">
                      <StatusChip tone={chip.tone} label={chip.label} dot />
                      <span className="line-clamp-2 text-sm">{t.title}</span>
                    </div>
                    {(t.functionPoints !== null || t.assignees.length > 0) && (
                      <div className="flex items-center gap-2">
                        {t.functionPoints !== null && (
                          <Badge variant="secondary" className="shrink-0">
                            {t.functionPoints} PFV
                          </Badge>
                        )}
                        {t.assignees.length > 0 && (
                          <span className="shrink-0 text-xs text-muted-foreground">
                            @{t.assignees.join(", ")}
                          </span>
                        )}
                      </div>
                    )}
                  </button>
                );
              })}
          </section>
        );
      })}

      <TaskSheetByRef
        taskId={openTaskId}
        onClose={() => setOpenTaskId(null)}
        onAfterChange={onReload}
      />
    </div>
  );
}
