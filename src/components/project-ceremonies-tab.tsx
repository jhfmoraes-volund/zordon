"use client";

import { useMemo, useState } from "react";
import { CalendarClock, Link2, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { TONE_DOT, type ChipTone } from "@/lib/status-chips";
import { fmtDate as fmtShortDate } from "@/lib/date-utils";

// ─── Protótipo de UI ───────────────────────────────────────────────────────
// Dados MOCKADOS in-file. Não há fetch, schema ou banco envolvido nesta leva —
// o objetivo é iterar na UX da aba Cerimônias antes de fechar o modelo.
// Modelo conceitual que estamos exercitando:
//   • Cerimônia = ARTEFATO do projeto (daily / planning / pm_review).
//   • Reunião   = EVENTO (transcript). Linka N:N ao artefato, opcionalmente.
// O badge "linkedMeetings" representa quantos eventos alimentam a cerimônia.

type CeremonyType = "daily" | "planning" | "pm_review";

type CeremonyStatus = "scheduled" | "in_progress" | "done";

type Ceremony = {
  id: string;
  type: CeremonyType;
  title: string;
  status: CeremonyStatus;
  date: string; // ISO
  sprintName: string | null;
  /** Quantas reuniões-evento (Meeting) estão linkadas a este artefato. */
  linkedMeetings: number;
  /** Resumo curto do que ficou decidido (vira insumo do status semanal). */
  summary: string | null;
};

const TYPE_LABELS: Record<CeremonyType, string> = {
  daily: "Daily",
  planning: "Planning",
  pm_review: "Review",
};

type FilterKey = "all" | CeremonyType;

const FILTERS: { key: FilterKey; label: string }[] = [
  { key: "all", label: "Todas" },
  { key: "daily", label: "Daily" },
  { key: "planning", label: "Planning" },
  { key: "pm_review", label: "Review" },
];

function statusTone(status: CeremonyStatus): ChipTone {
  if (status === "done") return "green";
  if (status === "in_progress") return "amber";
  return "muted";
}

const STATUS_LABELS: Record<CeremonyStatus, string> = {
  scheduled: "Agendada",
  in_progress: "Em andamento",
  done: "Concluída",
};

// Mock — substituído por fetch real quando o modelo estiver fechado.
const MOCK_CEREMONIES: Ceremony[] = [
  {
    id: "c1",
    type: "planning",
    title: "Sprint 14 · Planning",
    status: "done",
    date: "2026-05-25T13:00:00Z",
    sprintName: "Sprint 14",
    linkedMeetings: 1,
    summary:
      "Comprometido 42 FP. Foco em checkout + refino do onboarding do prestador.",
  },
  {
    id: "c2",
    type: "daily",
    title: "Daily · 26/05",
    status: "done",
    date: "2026-05-26T12:00:00Z",
    sprintName: "Sprint 14",
    linkedMeetings: 0,
    summary: "Bloqueio no gateway de pagamento; aguardando credencial do PSP.",
  },
  {
    id: "c3",
    type: "daily",
    title: "Daily · 27/05",
    status: "in_progress",
    date: "2026-05-27T12:00:00Z",
    sprintName: "Sprint 14",
    linkedMeetings: 0,
    summary: null,
  },
  {
    id: "c4",
    type: "pm_review",
    title: "Review de gestão · Semana 21",
    status: "scheduled",
    date: "2026-05-29T17:00:00Z",
    sprintName: null,
    linkedMeetings: 2,
    summary: null,
  },
];

type Props = {
  projectId: string;
  projectName: string;
  /** Manager-only actions (criar/editar). */
  canManage?: boolean;
};

export function ProjectCeremoniesTab({
  projectName,
  canManage = false,
}: Props) {
  const [ceremonies] = useState<Ceremony[]>(MOCK_CEREMONIES);
  const [filter, setFilter] = useState<FilterKey>("all");

  const counts = useMemo(() => {
    const c: Record<FilterKey, number> = {
      all: ceremonies.length,
      daily: 0,
      planning: 0,
      pm_review: 0,
    };
    for (const cer of ceremonies) c[cer.type] += 1;
    return c;
  }, [ceremonies]);

  const visible = useMemo(
    () =>
      filter === "all"
        ? ceremonies
        : ceremonies.filter((c) => c.type === filter),
    [ceremonies, filter],
  );

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <div
          role="tablist"
          aria-label="Filtrar cerimônias"
          className="inline-flex rounded-md border bg-muted/30 p-0.5 text-sm"
        >
          {FILTERS.map((f) => {
            const active = filter === f.key;
            return (
              <button
                key={f.key}
                role="tab"
                type="button"
                aria-selected={active}
                onClick={() => setFilter(f.key)}
                className={cn(
                  "rounded-sm px-2.5 py-1 text-xs transition-colors",
                  active
                    ? "bg-background text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {f.label}
                <span className="ml-1.5 font-mono text-[10px] tabular-nums text-muted-foreground">
                  {counts[f.key]}
                </span>
              </button>
            );
          })}
        </div>
        {canManage && (
          <Button size="sm" className="ml-auto" disabled title="Protótipo">
            <Plus className="size-3.5" />
            Cerimônia
          </Button>
        )}
      </div>

      {visible.length === 0 ? (
        <div className="py-12 text-center text-muted-foreground">
          <CalendarClock className="mx-auto mb-2 h-8 w-8 opacity-50" />
          <p>Nenhuma cerimônia.</p>
          <p className="text-sm">
            Daily, Planning e Review de {projectName} aparecem aqui.
          </p>
        </div>
      ) : (
        <ul className="divide-y rounded-md border bg-card">
          {visible.map((c) => (
            <li
              key={c.id}
              className="group flex items-center gap-3 px-3 py-2.5 transition-colors hover:bg-accent/40 focus-within:bg-accent/40"
            >
              <span
                aria-hidden
                className={cn(
                  "size-2 shrink-0 rounded-full",
                  TONE_DOT[statusTone(c.status)],
                )}
              />
              <button
                type="button"
                className="min-w-0 flex-1 text-left focus-visible:outline-none"
              >
                <div className="flex items-center gap-2">
                  <p className="truncate text-sm font-medium">{c.title}</p>
                  {c.linkedMeetings > 0 && (
                    <span
                      title={`${c.linkedMeetings} reunião(ões) linkada(s)`}
                      className="inline-flex shrink-0 items-center gap-0.5 rounded-sm border border-sky-200 bg-sky-50 px-1.5 py-0.5 text-[9px] font-medium text-sky-700 dark:border-sky-900/50 dark:bg-sky-950/40 dark:text-sky-300"
                    >
                      <Link2 className="size-2.5" />
                      {c.linkedMeetings}
                    </span>
                  )}
                  <span className="ml-auto hidden text-[10px] uppercase tracking-wider text-muted-foreground sm:inline">
                    {TYPE_LABELS[c.type]}
                  </span>
                </div>
                <p className="mt-0.5 truncate text-xs text-muted-foreground">
                  {STATUS_LABELS[c.status]}
                  {c.sprintName ? ` · ${c.sprintName}` : ""}
                  {c.summary ? ` · ${c.summary}` : ""}
                </p>
              </button>
              <span className="hidden w-14 shrink-0 text-right text-xs tabular-nums text-muted-foreground sm:inline">
                {fmtShortDate(c.date)}
              </span>
            </li>
          ))}
        </ul>
      )}

      <p className="px-1 text-[10px] text-muted-foreground">
        Protótipo · dados de exemplo. Modelo e persistência ainda não conectados.
      </p>
    </div>
  );
}
