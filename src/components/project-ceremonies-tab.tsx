"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { CalendarClock, Link2, Plus, StickyNote } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { TONE_DOT, type ChipTone } from "@/lib/status-chips";
import { fmtDate as fmtShortDate } from "@/lib/date-utils";
import { useOptimisticCollection } from "@/hooks/use-optimistic-collection";
import { fetchOrThrow, showErrorToast } from "@/lib/optimistic/toast";
import { tempId } from "@/lib/optimistic/reconcile";
import { toast } from "sonner";

// ─── Tab Rituais (user-facing) ──────────────────────────────────────────
// Conceito user-facing: "Ritual" — abarca Planning hoje, Daily/Review depois.
// Naming técnico (banco/código) preserva PlanningCeremony.
// MVP: só Planning está implementada. Daily/Review aparecem como botões
// "em breve" no filtro — sinalizam roadmap mas não fetcham.
// Click no card → navega pra /rituals/[id] (command center).

type Phase =
  | "idle"
  | "reading"
  | "proposing"
  | "approving"
  | "closed"
  | "archived";

/** Espelha PlanningSummary do DAL (src/lib/dal/planning.ts). */
type Planning = {
  id: string;
  projectId: string;
  sprintId: string | null;
  sprintName: string | null;
  phase: Phase;
  scheduledFor: string | null;
  startedAt: string | null;
  closedAt: string | null;
  facilitatorId: string | null;
  facilitatorName: string | null;
  linkedMeetingCount: number;
  linkedTranscriptCount: number;
  contextNoteCount: number;
  pendingActionCount: number;
};

const PHASE_LABEL: Record<Phase, string> = {
  idle: "Agendada",
  reading: "Lendo contexto",
  proposing: "Propondo tasks",
  approving: "Em aprovação",
  closed: "Concluída",
  archived: "Arquivada",
};

function phaseTone(p: Phase): ChipTone {
  if (p === "closed") return "green";
  if (p === "reading" || p === "proposing" || p === "approving") return "amber";
  return "muted";
}

type FilterKey = "all" | "planning";

const ACTIVE_FILTERS: { key: FilterKey; label: string }[] = [
  { key: "all", label: "Todas" },
  { key: "planning", label: "Planning" },
];

// Daily/Review ainda não têm modelo — botões disabled sinalizam roadmap.
const DISABLED_FILTERS: { label: string; hint: string }[] = [
  { label: "Daily", hint: "Em breve" },
  { label: "Review", hint: "Em breve" },
];

type Props = {
  projectId: string;
  projectName: string;
  /** Manager-only actions (criar). */
  canManage?: boolean;
};

export function ProjectCeremoniesTab({
  projectId,
  projectName,
  canManage = false,
}: Props) {
  const router = useRouter();
  const collection = useOptimisticCollection<Planning>([]);
  const plannings = collection.items;
  const setPlannings = collection.setCommitted;
  const mutate = collection.mutate;

  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<FilterKey>("all");
  const [creating, setCreating] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch(`/api/projects/${projectId}/plannings`);
      if (!r.ok) {
        setPlannings([]);
        return;
      }
      setPlannings((await r.json()) as Planning[]);
    } finally {
      setLoading(false);
    }
  }, [projectId, setPlannings]);

  useEffect(() => {
    load();
  }, [load]);

  const counts = useMemo(() => {
    // No MVP só temos planning — counts[all] = counts[planning].
    return { all: plannings.length, planning: plannings.length };
  }, [plannings]);

  const visible = useMemo(() => {
    // Hoje todo registro é planning; filtro só importa quando daily/review
    // entrarem. Mantém a estrutura pronta.
    return plannings;
  }, [plannings]);

  async function handleCreate() {
    if (creating) return;
    setCreating(true);
    try {
      const optimistic: Planning = {
        id: tempId("planning"),
        projectId,
        sprintId: null,
        sprintName: null,
        phase: "idle",
        scheduledFor: new Date().toISOString(),
        startedAt: null,
        closedAt: null,
        facilitatorId: null,
        facilitatorName: null,
        linkedMeetingCount: 0,
        linkedTranscriptCount: 0,
        contextNoteCount: 0,
        pendingActionCount: 0,
      };

      const created = await mutate(
        { type: "create", entity: optimistic },
        async (signal) => {
          const res = await fetchOrThrow("/api/planning", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ projectId }),
            signal,
          });
          const row = (await res.json()) as {
            id: string;
            phase: Phase;
            sprintId: string | null;
            scheduledFor: string | null;
            facilitatorId: string | null;
          };
          // Server retorna a row do banco (PlanningCeremonyRow), não o
          // shape de PlanningSummary. Convertemos pro shape da lista.
          const full: Planning = {
            ...optimistic,
            id: row.id,
            phase: row.phase,
            sprintId: row.sprintId,
            scheduledFor: row.scheduledFor,
            facilitatorId: row.facilitatorId,
          };
          return full;
        },
        {
          errorLabel: "Falha ao criar Planning",
          // Reconcile: substitui o temp pelo real (ref project_ui_patterns
          // → feedback_optimistic_reconcile_create).
          reconcile: (prev, real) => [
            ...prev.filter((p) => p.id !== optimistic.id),
            real,
          ],
        },
      );

      if (created) {
        toast.success("Ritual criado.");
        // Navega pro command center — UX natural: criou, abre pra trabalhar.
        router.push(`/rituals/${created.id}`);
      }
    } catch (err) {
      showErrorToast(err, { label: "Falha ao criar Planning" });
    } finally {
      setCreating(false);
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <div
          role="tablist"
          aria-label="Filtrar cerimônias"
          className="inline-flex rounded-md border bg-muted/30 p-0.5 text-sm"
        >
          {ACTIVE_FILTERS.map((f) => {
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
          {DISABLED_FILTERS.map((f) => (
            <button
              key={f.label}
              type="button"
              disabled
              title={f.hint}
              className="cursor-not-allowed rounded-sm px-2.5 py-1 text-xs text-muted-foreground/50"
            >
              {f.label}
              <span className="ml-1.5 text-[9px] uppercase tracking-wider">
                em breve
              </span>
            </button>
          ))}
        </div>
        {canManage && (
          <Button
            size="sm"
            className="ml-auto"
            onClick={handleCreate}
            disabled={creating}
          >
            <Plus className="size-3.5" />
            {creating ? "Criando…" : "Nova Planning"}
          </Button>
        )}
      </div>

      {loading ? (
        <p className="px-1 py-8 text-center text-sm text-muted-foreground">
          Carregando…
        </p>
      ) : visible.length === 0 ? (
        <div className="py-12 text-center text-muted-foreground">
          <CalendarClock className="mx-auto mb-2 h-8 w-8 opacity-50" />
          <p>Nenhum ritual em {projectName}.</p>
          {canManage && (
            <p className="text-sm">
              Crie o primeiro Ritual pra começar.
            </p>
          )}
        </div>
      ) : (
        <ul className="divide-y rounded-md border bg-card">
          {visible.map((p) => (
            <li key={p.id} className="contents">
              <button
                type="button"
                onClick={() => router.push(`/rituals/${p.id}`)}
                className="group flex w-full items-center gap-3 px-3 py-2.5 text-left transition-colors hover:bg-accent/40 focus-visible:bg-accent/40 focus-visible:outline-none"
              >
              <span
                aria-hidden
                className={cn(
                  "size-2 shrink-0 rounded-full",
                  TONE_DOT[phaseTone(p.phase)],
                )}
              />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <p className="truncate text-sm font-medium">
                    Planning
                    {p.sprintName ? ` · ${p.sprintName}` : ""}
                  </p>

                  {p.linkedMeetingCount + p.linkedTranscriptCount > 0 && (
                    <span
                      title={`${p.linkedMeetingCount} reunião(ões), ${p.linkedTranscriptCount} transcript(s)`}
                      className="inline-flex shrink-0 items-center gap-0.5 rounded-sm border border-sky-200 bg-sky-50 px-1.5 py-0.5 text-[9px] font-medium text-sky-700 dark:border-sky-900/50 dark:bg-sky-950/40 dark:text-sky-300"
                    >
                      <Link2 className="size-2.5" />
                      {p.linkedMeetingCount + p.linkedTranscriptCount}
                    </span>
                  )}

                  {p.contextNoteCount > 0 && (
                    <span
                      title={`${p.contextNoteCount} note(s) de briefing`}
                      className="inline-flex shrink-0 items-center gap-0.5 rounded-sm border border-violet-200 bg-violet-50 px-1.5 py-0.5 text-[9px] font-medium text-violet-700 dark:border-violet-900/50 dark:bg-violet-950/40 dark:text-violet-300"
                    >
                      <StickyNote className="size-2.5" />
                      {p.contextNoteCount}
                    </span>
                  )}

                  {p.pendingActionCount > 0 && (
                    <span
                      title={`${p.pendingActionCount} ação(ões) aguardando aprovação`}
                      className="shrink-0 text-[10px] font-medium text-amber-700 dark:text-amber-500"
                    >
                      ⚠ {p.pendingActionCount} pendente
                      {p.pendingActionCount > 1 ? "s" : ""}
                    </span>
                  )}

                  <span className="ml-auto hidden text-[10px] uppercase tracking-wider text-muted-foreground sm:inline">
                    {PHASE_LABEL[p.phase]}
                  </span>
                </div>
                <p className="mt-0.5 truncate text-xs text-muted-foreground">
                  {p.facilitatorName
                    ? `Facilitador: ${p.facilitatorName}`
                    : "Sem facilitador definido"}
                </p>
              </div>
              <span className="hidden w-14 shrink-0 text-right text-xs tabular-nums text-muted-foreground sm:inline">
                {fmtShortDate(p.scheduledFor ?? p.startedAt ?? null)}
              </span>
              </button>
            </li>
          ))}
        </ul>
      )}

      <p className="px-1 text-[10px] text-muted-foreground">
        Detalhe da Planning (command center) ainda em construção.
      </p>
    </div>
  );
}
