"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import { fetchOrThrow, showErrorToast } from "@/lib/optimistic/toast";
import type { PlanningAction } from "@/components/planning/proposal-card";

/** PlanningAction com o embed de sprint destino que o GET /actions devolve. */
export type ProposalRow = PlanningAction & {
  targetSprint?: { id: string; name: string } | null;
};

/** Task real do projeto = o board VIVO (qualquer status). */
export type BoardTask = {
  id: string;
  reference: string | null;
  title: string;
  status: string;
  sprintId: string | null;
  sprintName: string | null;
  sprintStartDate: string | null;
  sprintEndDate: string | null;
  functionPoints: number | null;
  assignees: string[];
};

export type PlanningCounts = {
  /** Propostas pendentes não-rejeitadas (entra no commit + badge). */
  pendingCount: number;
  /** Tasks no board vivo. */
  planCount: number;
  /** Quantas dessas done. */
  doneCount: number;
};

/**
 * Fonte ÚNICA dos dados do canvas do Planning: o BOARD VIVO (tasks reais) e as
 * PROPOSTAS pendentes (PlanningAction de task/story/module). Centralizar aqui
 * mantém as 3 lentes (Tasks / User Stories / Propostas) e o badge do toggle
 * consistentes — uma busca, contagens derivadas uma vez. Antes cada lente
 * re-fetchava /actions e misturava proposto com aplicado.
 */
export function usePlanningCanvasData(
  planningCeremonyId: string | null,
  projectId: string,
  refreshKey: number,
) {
  const [actions, setActions] = useState<ProposalRow[]>([]);
  const [boardTasks, setBoardTasks] = useState<BoardTask[]>([]);
  const [tick, setTick] = useState(0);

  // setState só na continuação da promise → sem set-state-in-effect.
  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      let acts: ProposalRow[] = [];
      if (planningCeremonyId) {
        try {
          const r = await fetch(`/api/planning/${planningCeremonyId}/actions`);
          acts = r.ok ? await r.json() : [];
        } catch {
          acts = [];
        }
      }
      let tasks: BoardTask[] = [];
      try {
        const tr = await fetch(`/api/tasks?projectId=${projectId}`);
        const rows = tr.ok
          ? ((await tr.json()) as Array<{
              id: string;
              reference: string | null;
              title: string;
              status: string;
              sprintId: string | null;
              functionPoints: number | null;
              sprint?: { name: string; startDate?: string; endDate?: string } | null;
              assignments?: Array<{ member?: { name: string } | null }> | null;
            }>)
          : [];
        tasks = (rows ?? []).map((t) => ({
          id: t.id,
          reference: t.reference,
          title: t.title,
          status: t.status,
          sprintId: t.sprintId,
          sprintName: t.sprint?.name ?? null,
          sprintStartDate: t.sprint?.startDate ?? null,
          sprintEndDate: t.sprint?.endDate ?? null,
          functionPoints: t.functionPoints,
          assignees: (t.assignments ?? [])
            .map((a) => a.member?.name)
            .filter((n): n is string => !!n),
        }));
      } catch {
        tasks = [];
      }
      if (!cancelled) {
        // Só propostas de execução pendente entram no canvas.
        setActions((acts ?? []).filter((a) => a.execution === "pending"));
        setBoardTasks(tasks);
      }
    };
    void run();
    return () => {
      cancelled = true;
    };
  }, [planningCeremonyId, projectId, refreshKey, tick]);

  const reload = useCallback(() => setTick((t) => t + 1), []);

  /** Descarta/restaura uma proposta (otimista + persiste; reverte no erro). */
  const setDecision = useCallback(
    async (actionId: string, decision: "pending" | "rejected") => {
      setActions((list) =>
        list.map((a) => (a.id === actionId ? { ...a, decision } : a)),
      );
      if (!planningCeremonyId) return;
      try {
        await fetchOrThrow(
          `/api/planning/${planningCeremonyId}/actions/${actionId}`,
          {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ decision }),
          },
        );
      } catch (err) {
        showErrorToast(err, { label: "Falha ao atualizar proposta" });
        setTick((t) => t + 1); // reverte recarregando do servidor
      }
    },
    [planningCeremonyId],
  );

  const taskProposals = useMemo(
    () => actions.filter((a) => (a.entityType ?? "task") === "task"),
    [actions],
  );
  const storyProposals = useMemo(
    () => actions.filter((a) => a.entityType === "story"),
    [actions],
  );
  const moduleProposals = useMemo(
    () => actions.filter((a) => a.entityType === "module"),
    [actions],
  );

  const counts = useMemo<PlanningCounts>(
    () => ({
      pendingCount: actions.filter((a) => a.decision !== "rejected").length,
      planCount: boardTasks.length,
      doneCount: boardTasks.filter((t) => t.status === "done").length,
    }),
    [actions, boardTasks],
  );

  return {
    boardTasks,
    taskProposals,
    storyProposals,
    moduleProposals,
    counts,
    reload,
    setDecision,
  };
}
