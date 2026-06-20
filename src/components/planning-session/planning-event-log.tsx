"use client";

import { useEffect, useState } from "react";
import { ChevronDown, ChevronRight, History } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Markdown } from "@/components/ui/markdown";
import { fmtDateTime } from "@/lib/date-utils";

/** Child row de FP por sprint (snapshot imutável). */
type EventSprint = {
  id: string;
  sprintId: string | null;
  sprintLabel: string;
  fpTotal: number;
  taskCount: number;
};

/** Uma versão aplicada do plano. Espelha PlanningEventWithSprints (server-only). */
type PlanningEvent = {
  id: string;
  createdAt: string;
  createdByName: string | null;
  appliedCount: number;
  failedCount: number;
  skippedCount: number;
  briefingMarkdown: string | null;
  sprints: EventSprint[];
};

/**
 * Histórico (Log) das versões aplicadas de um Release Planning — Planning Vivo
 * Versionado, Fase 1. É o `git log` do plano: cada "Aplicar" virou um
 * PlanningEvent (snapshot de FP por sprint + briefing). Substitui o "Plano vazio"
 * que apagava a visão do plano ao aplicar.
 *
 * INVARIANTE: o snapshot é histórico imutável — informa, não restaura. (Restaurar/
 * diffar versão é ação explícita e separada, Fase ≥ 2.)
 */
export function PlanningEventLog({
  sessionId,
  refreshKey,
  onCountChange,
}: {
  sessionId: string | null;
  refreshKey: number;
  /** Reporta quantas versões existem — a página esconde o empty-state se > 0. */
  onCountChange?: (n: number) => void;
}) {
  const [events, setEvents] = useState<PlanningEvent[]>([]);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  // Fetch inline com setState dentro do callback do .then() (não direto no corpo
  // do effect) — padrão que o react-hooks/set-state-in-effect aceita. refreshKey
  // re-dispara após cada apply.
  useEffect(() => {
    if (!sessionId) return;
    let cancelled = false;
    fetch(`/api/planning-sessions/${sessionId}/events`)
      .then((res) => (res.ok ? res.json() : { events: [] }))
      .then((data: { events: PlanningEvent[] }) => {
        if (!cancelled) setEvents(data.events ?? []);
      })
      .catch(() => {
        // silencioso — o Log apenas não renderiza
      });
    return () => {
      cancelled = true;
    };
  }, [sessionId, refreshKey]);

  useEffect(() => {
    onCountChange?.(events.length);
  }, [events.length, onCountChange]);

  const toggle = (id: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  if (events.length === 0) return null;

  return (
    <div className="rounded-lg border bg-card">
      <div className="flex items-center gap-2 border-b px-3 py-2 text-sm font-medium">
        <History className="size-4 text-muted-foreground" />
        Histórico do plano
        <Badge variant="secondary">{events.length}</Badge>
      </div>

      <div className="divide-y">
        {events.map((ev) => {
          const isOpen = expanded.has(ev.id);
          const counts = [
            ev.appliedCount > 0 ? `${ev.appliedCount} aplicada${ev.appliedCount === 1 ? "" : "s"}` : null,
            ev.failedCount > 0 ? `${ev.failedCount} falhou` : null,
            ev.skippedCount > 0 ? `${ev.skippedCount} pulada${ev.skippedCount === 1 ? "" : "s"}` : null,
          ]
            .filter(Boolean)
            .join(" · ");
          return (
            <div key={ev.id}>
              <button
                type="button"
                onClick={() => toggle(ev.id)}
                className="flex w-full items-start gap-2 px-3 py-2.5 text-left hover:bg-accent/40"
              >
                {isOpen ? (
                  <ChevronDown className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                ) : (
                  <ChevronRight className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                )}
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-sm">
                    <span className="font-medium">{fmtDateTime(ev.createdAt)}</span>
                    {ev.createdByName && (
                      <span className="text-xs text-muted-foreground">
                        por {ev.createdByName}
                      </span>
                    )}
                    {counts && (
                      <span className="text-xs text-muted-foreground">· {counts}</span>
                    )}
                  </div>
                  {/* Chips de FP por sprint — o snapshot denormalizado, imutável. */}
                  {ev.sprints.length > 0 && (
                    <div className="mt-1.5 flex flex-wrap gap-1">
                      {ev.sprints.map((s) => (
                        <Badge
                          key={s.id}
                          variant="outline"
                          title={`${s.taskCount} task${s.taskCount === 1 ? "" : "s"}`}
                        >
                          {s.sprintLabel} · {s.fpTotal} FP
                        </Badge>
                      ))}
                    </div>
                  )}
                </div>
              </button>

              {isOpen && ev.briefingMarkdown && (
                <div className="border-t bg-muted/20 px-3 py-3 pl-9">
                  <Markdown>{ev.briefingMarkdown}</Markdown>
                </div>
              )}
              {isOpen && !ev.briefingMarkdown && (
                <div className="border-t bg-muted/20 px-3 py-3 pl-9 text-xs text-muted-foreground">
                  Sem briefing capturado nesta versão.
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
