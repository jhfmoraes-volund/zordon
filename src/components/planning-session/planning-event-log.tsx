"use client";

import { History } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { fmtDateTime } from "@/lib/date-utils";

/** Child row de PFV por sprint (snapshot imutável). */
export type EventSprint = {
  id: string;
  sprintId: string | null;
  sprintLabel: string;
  fpTotal: number;
  taskCount: number;
};

/** Uma versão aplicada do plano. Espelha PlanningEventWithSprints (server-only). */
export type PlanningEvent = {
  id: string;
  createdAt: string;
  createdByName: string | null;
  appliedCount: number;
  failedCount: number;
  skippedCount: number;
  briefingMarkdown: string | null;
  sprints: EventSprint[];
};

/** Linha resumida de counts ("3 aplicadas · 1 falhou · …"). */
export function eventCountsLine(ev: PlanningEvent): string {
  return [
    ev.appliedCount > 0
      ? `${ev.appliedCount} aplicada${ev.appliedCount === 1 ? "" : "s"}`
      : null,
    ev.failedCount > 0 ? `${ev.failedCount} falhou` : null,
    ev.skippedCount > 0
      ? `${ev.skippedCount} pulada${ev.skippedCount === 1 ? "" : "s"}`
      : null,
  ]
    .filter(Boolean)
    .join(" · ");
}

/**
 * Linha de uma versão do plano (PlanningEvent) — clicável, selecionável. É o
 * "git log" do plano: data + quem aplicou + counts + chips de PFV por sprint
 * (snapshot denormalizado, imutável). Selecionar carrega o canvas histórico
 * daquela versão (o briefing vive lá, não inline). Compartilhada pela drawer
 * de logs da semana e por qualquer lista de versões.
 *
 * INVARIANTE: o snapshot é histórico imutável — informa, não restaura.
 */
export function PlanningEventRow({
  event,
  selected = false,
  onSelect,
}: {
  event: PlanningEvent;
  selected?: boolean;
  onSelect: (id: string) => void;
}) {
  const counts = eventCountsLine(event);
  return (
    <button
      type="button"
      onClick={() => onSelect(event.id)}
      aria-pressed={selected}
      className={cn(
        "flex w-full items-start gap-2 px-3 py-2.5 text-left transition-colors hover:bg-accent/40",
        selected && "bg-primary/10 ring-1 ring-inset ring-primary/40",
      )}
    >
      <History className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-sm">
          <span className="font-medium">{fmtDateTime(event.createdAt)}</span>
          {event.createdByName && (
            <span className="text-xs text-muted-foreground">
              por {event.createdByName}
            </span>
          )}
          {counts && (
            <span className="text-xs text-muted-foreground">· {counts}</span>
          )}
        </div>
        {/* Chips de PFV por sprint — o snapshot denormalizado, imutável. */}
        {event.sprints.length > 0 && (
          <div className="mt-1.5 flex flex-wrap gap-1">
            {event.sprints.map((s) => (
              <Badge
                key={s.id}
                variant="outline"
                title={`${s.taskCount} task${s.taskCount === 1 ? "" : "s"}`}
              >
                {s.sprintLabel} · {s.fpTotal} PFV
              </Badge>
            ))}
          </div>
        )}
      </div>
    </button>
  );
}
