"use client";

import { useEffect, useMemo, useState } from "react";
import { History, Loader2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { StatusChip } from "@/components/ui/status-chip";
import { Markdown } from "@/components/ui/markdown";
import { TASK_STATUS } from "@/lib/status-chips";
import { fmtDateTime } from "@/lib/date-utils";
import { eventCountsLine, type PlanningEvent } from "@/components/planning-session/planning-event-log";

/** Task do snapshot (espelha PlanningEventTask). */
type SnapshotTask = {
  id: string;
  reference: string | null;
  title: string;
  status: string;
  sprintId: string | null;
  sprintLabel: string;
  functionPoints: number | null;
  assignees: string[];
};

type SnapshotEvent = PlanningEvent & { tasks: SnapshotTask[] };

type Group = {
  sprintId: string | null;
  sprintLabel: string;
  tasks: SnapshotTask[];
};

const NONE_KEY = "__none__";

function statusChip(status: string): {
  label: string;
  tone: Parameters<typeof StatusChip>[0]["tone"];
} {
  const desc = TASK_STATUS[status as keyof typeof TASK_STATUS];
  return desc ?? { label: status, tone: "muted" };
}

/**
 * Canvas HISTÓRICO (read-only) de uma versão do Release Planning. Renderiza o
 * snapshot imutável daquele "Aplicar": briefing + o board exato (tasks por
 * sprint, com status/FP/assignees congelados). Sem edição, sem apply — informa,
 * não restaura (restaurar versão é feature futura).
 */
export function PlanningHistoricalCanvas({
  sessionId,
  eventId,
}: {
  sessionId: string;
  eventId: string;
}) {
  // `loaded` é keyed pelo eventId que resolveu — só setState no callback do fetch
  // (evita setState síncrono no corpo do effect). `loading` é derivado.
  const [loaded, setLoaded] = useState<{
    forEventId: string;
    event: SnapshotEvent | null;
  } | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/planning-sessions/${sessionId}/events/${eventId}`)
      .then((res) => (res.ok ? res.json() : { event: null }))
      .then((data: { event: SnapshotEvent | null }) => {
        if (!cancelled) setLoaded({ forEventId: eventId, event: data.event ?? null });
      })
      .catch(() => {
        if (!cancelled) setLoaded({ forEventId: eventId, event: null });
      });
    return () => {
      cancelled = true;
    };
  }, [sessionId, eventId]);

  const loading = loaded?.forEventId !== eventId;
  const event = loading ? null : loaded?.event ?? null;

  const groups = useMemo<Group[]>(() => {
    if (!event) return [];
    const map = new Map<string, Group>();
    for (const t of event.tasks) {
      const key = t.sprintId ?? NONE_KEY;
      let g = map.get(key);
      if (!g) {
        g = { sprintId: t.sprintId, sprintLabel: t.sprintLabel, tasks: [] };
        map.set(key, g);
      }
      g.tasks.push(t);
    }
    return Array.from(map.values()).sort((a, b) => {
      if (a.sprintId === null) return 1;
      if (b.sprintId === null) return -1;
      return a.sprintLabel.localeCompare(b.sprintLabel, undefined, { numeric: true });
    });
  }, [event]);

  if (loading) {
    return (
      <div className="flex items-center gap-2 rounded-lg border bg-card p-6 text-sm text-muted-foreground">
        <Loader2 className="size-4 animate-spin" />
        Carregando versão…
      </div>
    );
  }

  if (!event) {
    return (
      <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
        Versão não encontrada.
      </div>
    );
  }

  const counts = eventCountsLine(event);

  return (
    <div className="space-y-4">
      {/* Cabeçalho da versão — banner read-only. */}
      <div className="rounded-lg border bg-muted/30 px-3 py-2.5">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-sm">
          <History className="size-4 text-muted-foreground" />
          <span className="font-medium">Versão de {fmtDateTime(event.createdAt)}</span>
          {event.createdByName && (
            <span className="text-xs text-muted-foreground">por {event.createdByName}</span>
          )}
          <Badge variant="outline" className="ml-auto">
            histórico
          </Badge>
        </div>
        {counts && (
          <p className="mt-1 text-xs text-muted-foreground">{counts}</p>
        )}
      </div>

      {/* Board congelado: tasks por sprint. */}
      {groups.length > 0 ? (
        <div className="rounded-lg border bg-card divide-y">
          {groups.map((g) => {
            const fpTotal = g.tasks.reduce((s, t) => s + (t.functionPoints ?? 0), 0);
            return (
              <section key={g.sprintId ?? NONE_KEY}>
                <header className="flex items-center gap-2 bg-muted/40 px-3 py-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  <span>{g.sprintLabel}</span>
                  <span className="font-mono normal-case tracking-normal">
                    {g.tasks.length} task{g.tasks.length === 1 ? "" : "s"} · {fpTotal} FP
                  </span>
                </header>
                {g.tasks.map((t) => {
                  const chip = statusChip(t.status);
                  return (
                    <div
                      key={t.id}
                      className="flex items-center gap-2 px-3 py-2"
                    >
                      <StatusChip tone={chip.tone} label={chip.label} dot />
                      <span className="truncate text-sm">{t.title}</span>
                      {t.functionPoints !== null && (
                        <Badge variant="secondary" className="shrink-0">
                          {t.functionPoints} FP
                        </Badge>
                      )}
                      {t.assignees.length > 0 && (
                        <span className="shrink-0 text-xs text-muted-foreground">
                          @{t.assignees.join(", ")}
                        </span>
                      )}
                    </div>
                  );
                })}
              </section>
            );
          })}
        </div>
      ) : (
        <div className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
          Sem tasks capturadas nesta versão.
        </div>
      )}

      {/* Briefing daquela versão (cópia imutável do turn da Vitoria). */}
      {event.briefingMarkdown && (
        <div className="rounded-lg border bg-card p-3">
          <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Briefing
          </div>
          <Markdown>{event.briefingMarkdown}</Markdown>
        </div>
      )}
    </div>
  );
}
