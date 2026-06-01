"use client";

import { useState } from "react";
import { toast } from "sonner";
import type { createClient } from "@/lib/supabase/client";
import { fetchOrThrow, showErrorToast } from "@/lib/optimistic/toast";
import type { SprintFormData } from "@/components/sprint-dialog";
import type { SprintContextSheetMode } from "@/components/sprint/sprint-context-sheet";
import type {
  NavValue,
  Sprint as SprintView,
  SprintDeleteAction,
} from "@/components/sprint";

/**
 * Estado de UI de sprint (dialogs/sheets) + os 9 handlers de sprint:
 * create/update, request/handle de activate/reopen, complete, e delete.
 *
 * Sem optimistic — create usa `supabase.from("Sprint").insert`, o resto usa
 * `fetchOrThrow` + `loadTasksAndSprints`. `deleteSprint` lê `sprintView` para
 * reposicionar a view quando a sprint deletada é a focada. Veja
 * docs/platform/projects-page-refactor-runbook.md §4.1.
 */
export function useSprintActions(args: {
  id: string;
  supabase: ReturnType<typeof createClient>;
  sprints: SprintView[];
  loadTasksAndSprints: () => Promise<void>;
  sprintView: NavValue | null;
  setSprintView: (v: NavValue | null) => void;
}) {
  const { id, supabase, sprints, loadTasksAndSprints, sprintView, setSprintView } =
    args;

  const [sprintDialogOpen, setSprintDialogOpen] = useState(false);
  const [suggestSheetOpen, setSuggestSheetOpen] = useState(false);
  const [suggestSheetTargetId, setSuggestSheetTargetId] = useState<
    string | null
  >(null);
  const [sprintAction, setSprintAction] = useState<
    | { mode: "activate-replacing" | "activate-fresh"; targetId: string }
    | { mode: "reopen-replacing" | "reopen-fresh"; targetId: string }
    | null
  >(null);
  const [sprintDeleteTargetId, setSprintDeleteTargetId] = useState<
    string | null
  >(null);
  const [sprintEditingId, setSprintEditingId] = useState<string | null>(null);
  const [sprintContextSheet, setSprintContextSheet] = useState<{
    sprintId: string;
    mode: SprintContextSheetMode;
  } | null>(null);

  async function handleCreateSprint(form: SprintFormData) {
    const now = new Date().toISOString();
    setSprintDialogOpen(false);
    const goal = form.goal.trim();
    const newId = crypto.randomUUID();
    const { error } = await supabase.from("Sprint").insert({
      id: newId,
      projectId: id,
      name: form.name,
      startDate: form.startDate,
      endDate: form.endDate,
      status: form.status,
      goal: goal === "" ? null : goal,
      updatedAt: now,
    });
    if (error) {
      const message =
        error.code === "23505"
          ? error.message.includes("sprint_unique_week_per_project")
            ? "Já existe um sprint nessa semana neste projeto."
            : "Já existe um sprint com esse nome neste projeto."
          : error.message;
      showErrorToast(new Error(message), { label: "Falha ao criar sprint" });
      return;
    }
    await loadTasksAndSprints();
    if (form.autoFillFromBacklog) {
      setSuggestSheetTargetId(newId);
      setSuggestSheetOpen(true);
    }
  }

  async function handleUpdateSprint(targetId: string, form: SprintFormData) {
    setSprintEditingId(null);
    const goal = form.goal.trim();
    // status só vai no PUT quando muda de verdade. Transições active/completed
    // têm endpoints dedicados (/activate, /complete) e o PUT as rejeita — então
    // reenviar o status atual de uma sprint ativa ao editar datas dispara 400.
    const current = sprints.find((s) => s.id === targetId);
    const statusChanged = !current || form.status !== current.status;
    try {
      await fetchOrThrow(`/api/sprints/${targetId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: form.name,
          startDate: form.startDate,
          endDate: form.endDate,
          ...(statusChanged ? { status: form.status } : {}),
          goal: goal === "" ? null : goal,
        }),
      });
      toast.success("Sprint atualizada");
      await loadTasksAndSprints();
    } catch (e) {
      showErrorToast(e, { label: "Falha ao atualizar sprint" });
    }
  }

  function requestActivateSprint(targetId: string) {
    const hasActive = sprints.some((s) => s.status === "active");
    setSprintAction({
      mode: hasActive ? "activate-replacing" : "activate-fresh",
      targetId,
    });
  }

  function requestCompleteSprint(targetId: string) {
    setSprintContextSheet({ sprintId: targetId, mode: "complete" });
  }

  function requestReopenSprint(targetId: string) {
    const hasActive = sprints.some((s) => s.status === "active");
    setSprintAction({
      mode: hasActive ? "reopen-replacing" : "reopen-fresh",
      targetId,
    });
  }

  async function handleActivateSprint(targetId: string) {
    try {
      await fetchOrThrow(`/api/sprints/${targetId}/activate`, { method: "POST" });
      toast.success("Sprint ativada");
      await loadTasksAndSprints();
    } catch (e) {
      showErrorToast(e, { label: "Falha ao ativar sprint" });
    }
  }

  async function handleReopenSprint(targetId: string) {
    try {
      await fetchOrThrow(`/api/sprints/${targetId}/reopen`, { method: "POST" });
      toast.success("Sprint reaberta");
      await loadTasksAndSprints();
    } catch (e) {
      showErrorToast(e, { label: "Falha ao reabrir sprint" });
    }
  }

  function handleDeleteSprint(targetId: string) {
    setSprintDeleteTargetId(targetId);
  }

  async function deleteSprint(
    targetId: string,
    action: SprintDeleteAction,
    taskCount: number,
  ) {
    try {
      await fetchOrThrow(`/api/sprints/${targetId}`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ taskAction: action }),
      });
      // Mensagem reflete o que de fato aconteceu: sprint vazia não tem
      // tasks pra mover, mesmo que o action canônico seja "moveToBacklog".
      const message =
        taskCount === 0
          ? "Sprint excluída"
          : action === "moveToBacklog"
            ? "Sprint excluída · tasks movidas pro backlog"
            : "Sprint e tasks excluídas";
      toast.success(message);
      if (sprintView === targetId) setSprintView(null);
      await loadTasksAndSprints();
    } catch (e) {
      showErrorToast(e, { label: "Falha ao excluir sprint" });
      throw e;
    }
  }

  return {
    sprintDialogOpen,
    setSprintDialogOpen,
    suggestSheetOpen,
    setSuggestSheetOpen,
    suggestSheetTargetId,
    setSuggestSheetTargetId,
    sprintAction,
    setSprintAction,
    sprintDeleteTargetId,
    setSprintDeleteTargetId,
    sprintEditingId,
    setSprintEditingId,
    sprintContextSheet,
    setSprintContextSheet,
    handleCreateSprint,
    handleUpdateSprint,
    requestActivateSprint,
    requestCompleteSprint,
    requestReopenSprint,
    handleActivateSprint,
    handleReopenSprint,
    handleDeleteSprint,
    deleteSprint,
  };
}
