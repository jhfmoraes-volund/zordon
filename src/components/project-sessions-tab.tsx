"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Lightbulb, Play, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SuperSessionModal } from "@/components/design-session/super-session-modal";
import {
  SessionDetailSheet,
  type SessionDetailSummary,
} from "@/components/design-session/session-detail-sheet";
import {
  ConfirmDialog,
  type ConfirmState,
} from "@/components/ui/confirm-dialog";
import { toast } from "sonner";
import { createClient } from "@/lib/supabase/client";
import { useOptimisticCollection } from "@/hooks/use-optimistic-collection";
import { fetchOrThrow, showErrorToast } from "@/lib/optimistic/toast";
import { getStepsForSession } from "@/lib/design-session-steps";
import { cn } from "@/lib/utils";
import { TONE_DOT, type ChipTone } from "@/lib/status-chips";

type DesignSession = {
  id: string;
  title: string;
  type: string;
  status: string;
  selectedSteps: string[] | null;
  currentStep: number;
  totalSteps: number;
  createdAt: string;
  completedAt: string | null;
  scheduledAt: string | null;
  actualDurationMin: number | null;
  item_count: number;
  visibility: "public" | "internal";
};

type FilterKey = "all" | "active" | "completed";

const FILTERS: { key: FilterKey; label: string }[] = [
  { key: "all", label: "Todas" },
  { key: "active", label: "Ativas" },
  { key: "completed", label: "Concluídas" },
];

const ACTIVE_STATUSES = new Set(["draft", "in_progress"]);
const COMPLETED_STATUSES = new Set(["completed", "done"]);

function statusTone(status: string): ChipTone {
  if (COMPLETED_STATUSES.has(status)) return "green";
  if (status === "in_progress") return "amber";
  return "muted";
}

const TYPE_LABELS: Record<string, string> = {
  inception: "Inception",
  continuous_improvement: "Melhoria Contínua",
  super: "Inception",
};

type Props = {
  projectId: string;
  projectName: string;
  /** Whether the viewer can export JSON (manager-only). */
  canManage?: boolean;
};

export function ProjectSessionsTab({
  projectId,
  projectName,
  canManage = false,
}: Props) {
  const sessionsCollection = useOptimisticCollection<DesignSession>([]);
  const sessions = sessionsCollection.items;
  const setSessions = sessionsCollection.setCommitted;
  const sessionMutate = sessionsCollection.mutate;
  const [loading, setLoading] = useState(true);
  const [superOpen, setSuperOpen] = useState(false);
  const [exportingId, setExportingId] = useState<string | null>(null);
  const [openSessionId, setOpenSessionId] = useState<string | null>(null);
  const [confirmState, setConfirmState] = useState<ConfirmState | null>(null);
  const [filter, setFilter] = useState<FilterKey>("all");

  const counts = useMemo(() => {
    let active = 0;
    let completed = 0;
    for (const s of sessions) {
      if (COMPLETED_STATUSES.has(s.status)) completed += 1;
      else if (ACTIVE_STATUSES.has(s.status)) active += 1;
    }
    return { all: sessions.length, active, completed };
  }, [sessions]);

  const visibleSessions = useMemo(() => {
    if (filter === "active")
      return sessions.filter((s) => ACTIVE_STATUSES.has(s.status));
    if (filter === "completed")
      return sessions.filter((s) => COMPLETED_STATUSES.has(s.status));
    return sessions;
  }, [sessions, filter]);

  const openSession = openSessionId
    ? sessions.find((s) => s.id === openSessionId) ?? null
    : null;

  const openSummary: SessionDetailSummary | null = openSession
    ? {
        id: openSession.id,
        title: openSession.title,
        type: openSession.type,
        status: openSession.status,
        currentStep: openSession.currentStep,
        totalSteps: openSession.totalSteps,
        createdAt: openSession.createdAt,
        completedAt: openSession.completedAt,
        scheduledAt: openSession.scheduledAt,
        actualDurationMin: openSession.actualDurationMin,
        itemCount: openSession.item_count ?? 0,
        visibility: openSession.visibility,
        projectId,
      }
    : null;

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const supabase = createClient();
      // A view design_session_summary não traz selectedSteps (campo do super
      // type). Carregamos via DesignSession e fazemos merge in-memory.
      const [summaryRes, sessionsRes] = await Promise.all([
        supabase
          .from("design_session_summary")
          .select("*")
          .eq("projectId", projectId)
          .order("createdAt", { ascending: false }),
        supabase
          .from("DesignSession")
          .select("id, selectedSteps")
          .eq("projectId", projectId),
      ]);
      if (summaryRes.error) {
        console.error("[ProjectSessionsTab.load]", summaryRes.error);
        setSessions([]);
        return;
      }
      const selectedStepsById = new Map<string, string[] | null>();
      for (const row of sessionsRes.data ?? []) {
        selectedStepsById.set(row.id, row.selectedSteps ?? null);
      }
      setSessions(
        ((summaryRes.data ?? []) as unknown as DesignSession[]).map((s) => ({
          ...s,
          selectedSteps: selectedStepsById.get(s.id) ?? null,
        })),
      );
    } finally {
      setLoading(false);
    }
  }, [projectId, setSessions]);

  useEffect(() => {
    load();
  }, [load]);

  function remove(id: string) {
    const session = sessions.find((s) => s.id === id);
    if (!session) return;
    setConfirmState({
      title: `Excluir "${session.title}"?`,
      description:
        "A session, items e participantes serão removidos permanentemente.",
      confirmLabel: "Excluir",
      destructive: true,
      onConfirm: async () => {
        const result = await sessionMutate(
          { type: "delete", id },
          async (signal) => {
            const res = await fetchOrThrow(`/api/design-sessions/${id}`, {
              method: "DELETE",
              signal,
            });
            return (await res.json().catch(() => ({}))) as { ok?: true };
          },
          {
            errorLabel: "Falha ao remover session",
            reconcile: (prev) => prev.filter((s) => s.id !== id),
          },
        );
        if (result) {
          setOpenSessionId((current) => (current === id ? null : current));
          toast.success("Session excluída.");
        }
      },
    });
  }

  async function exportJson(id: string) {
    setExportingId(id);
    try {
      const supabase = createClient();
      const {
        data: { session: authSession },
      } = await supabase.auth.getSession();
      if (!authSession) {
        showErrorToast(new Error("Sessão expirada. Faça login novamente."), {
          label: "Auth",
        });
        return;
      }
      const url = `${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/export-design-session`;
      const res = await fetch(url, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${authSession.access_token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ sessionId: id }),
      });
      if (!res.ok) {
        showErrorToast(new Error(await res.text()), {
          label: "Erro ao exportar",
        });
        return;
      }
      const cd = res.headers.get("Content-Disposition") ?? "";
      const filename =
        cd.match(/filename="([^"]+)"/)?.[1] ?? `session-${id}.json`;
      const blob = await res.blob();
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(a.href);
    } finally {
      setExportingId(null);
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <div
          role="tablist"
          aria-label="Filtrar sessions"
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
        <Button size="sm" className="ml-auto" onClick={() => setSuperOpen(true)}>
          <Plus className="size-3.5" />
          Inception
        </Button>
      </div>

      <SuperSessionModal
        projectId={projectId}
        projectName={projectName}
        open={superOpen}
        onOpenChange={setSuperOpen}
        onCreated={load}
      />

      {loading ? (
        <p className="text-sm text-muted-foreground">Carregando…</p>
      ) : sessions.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground">
          <Lightbulb className="mx-auto h-8 w-8 mb-2 opacity-50" />
          <p>Nenhuma Design Session.</p>
          <p className="text-sm">
            Crie uma Inception para mapear o escopo do projeto.
          </p>
        </div>
      ) : visibleSessions.length === 0 ? (
        <div className="surface px-3 py-8 text-center text-sm text-muted-foreground">
          Nenhuma session {filter === "active" ? "ativa" : "concluída"}.
        </div>
      ) : (
        <ul className="divide-y rounded-md border bg-card">
          {visibleSessions.map((s) => {
            const isCompleted = COMPLETED_STATUSES.has(s.status);
            const visibleStep = Math.min(s.currentStep + 1, s.totalSteps);
            const progressPct = Math.min(
              100,
              Math.round((visibleStep / Math.max(s.totalSteps, 1)) * 100),
            );
            const playStepIdx = isCompleted
              ? Math.max(0, s.totalSteps - 1)
              : Math.min(s.currentStep, Math.max(0, s.totalSteps - 1));
            const stepDefs = getStepsForSession({
              type: s.type,
              selectedSteps: s.selectedSteps,
            });
            const currentStepName =
              stepDefs[Math.min(s.currentStep, stepDefs.length - 1)]?.title;
            return (
              <li
                key={s.id}
                className="group flex items-center gap-3 px-3 py-2.5 transition-colors hover:bg-accent/40 focus-within:bg-accent/40"
              >
                <span
                  aria-hidden
                  className={cn(
                    "size-2 shrink-0 rounded-full",
                    TONE_DOT[statusTone(s.status)],
                  )}
                />
                <button
                  type="button"
                  onClick={() => setOpenSessionId(s.id)}
                  className="min-w-0 flex-1 text-left focus-visible:outline-none"
                >
                  <div className="flex items-center gap-2">
                    <p className="truncate text-sm font-medium">{s.title}</p>
                    {s.visibility === "public" && (
                      <span
                        title="Visível pra guests"
                        className="shrink-0 rounded-sm border border-emerald-200 bg-emerald-50 px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-wider text-emerald-700 dark:border-emerald-900/50 dark:bg-emerald-950/40 dark:text-emerald-300"
                      >
                        Pública
                      </span>
                    )}
                    <Link
                      href={`/design-sessions/${s.id}/steps/${playStepIdx}`}
                      aria-label={
                        isCompleted ? "Ver session" : "Continuar session"
                      }
                      onClick={(e) => e.stopPropagation()}
                      className="inline-flex size-6 shrink-0 items-center justify-center rounded-md bg-primary text-primary-foreground transition-colors hover:bg-primary/85 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
                    >
                      <Play className="size-3 fill-current" />
                    </Link>
                    <span className="ml-auto hidden text-[10px] uppercase tracking-wider text-muted-foreground sm:inline">
                      {TYPE_LABELS[s.type] ?? s.type}
                    </span>
                  </div>
                  <p className="mt-0.5 truncate text-xs text-muted-foreground">
                    {isCompleted
                      ? `Concluída · ${s.totalSteps}/${s.totalSteps}`
                      : `Step ${visibleStep}/${s.totalSteps}${currentStepName ? ` · ${currentStepName}` : ""}`}
                  </p>
                </button>
                <div className="hidden h-1 w-20 shrink-0 overflow-hidden rounded-full bg-muted sm:block">
                  <div
                    className={cn(
                      "h-full rounded-full transition-[width]",
                      isCompleted ? "bg-green-500/70" : "bg-primary",
                    )}
                    style={{ width: `${progressPct}%` }}
                  />
                </div>
                <span className="hidden w-14 shrink-0 text-right text-xs tabular-nums text-muted-foreground sm:inline">
                  {fmtShortDate(s.completedAt ?? s.createdAt)}
                </span>
              </li>
            );
          })}
        </ul>
      )}

      <SessionDetailSheet
        session={openSummary}
        canManage={canManage}
        exporting={openSessionId !== null && exportingId === openSessionId}
        onClose={() => setOpenSessionId(null)}
        onExport={canManage ? exportJson : undefined}
        onDelete={remove}
        onVisibilityChanged={(id, visibility) => {
          setSessions((prev) =>
            prev.map((s) => (s.id === id ? { ...s, visibility } : s)),
          );
        }}
      />

      <ConfirmDialog
        state={confirmState}
        onClose={() => setConfirmState(null)}
      />
    </div>
  );
}

function fmtShortDate(iso: string) {
  return new Date(iso).toLocaleDateString("pt-BR", {
    day: "2-digit",
    month: "short",
  });
}
