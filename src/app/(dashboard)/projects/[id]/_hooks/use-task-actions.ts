"use client";

import { useState, type Dispatch, type MutableRefObject, type SetStateAction } from "react";
import { toast } from "sonner";
import { type ConfirmState } from "@/components/ui/confirm-dialog";
import type { createClient } from "@/lib/supabase/client";
import { fetchOrThrow, showErrorToast } from "@/lib/optimistic/toast";
import { tempId as makeTempId } from "@/lib/optimistic/reconcile";
import { suggestFunctionPoints } from "@/lib/function-points";
import type { ChipTone } from "@/lib/status-chips";
import type { useOptimisticCollection } from "@/hooks/use-optimistic-collection";
import type {
  AdaptedStory,
  AdaptedTask,
} from "@/components/story-hierarchy/adapters";
import type { ProjectLite, TaskTag } from "@/components/story-hierarchy";
import type { AcceptanceCriterionRow } from "@/lib/dal/story-hierarchy";
import type { ProjectMeta, RawMember, RawTask } from "../_types";

type TaskCollection = ReturnType<typeof useOptimisticCollection<RawTask>>;
type TaskMutate = TaskCollection["mutate"];
type AcCollection = ReturnType<
  typeof useOptimisticCollection<AcceptanceCriterionRow>
>;

/**
 * O maior cluster: 25 handlers de task + os helpers findTaskIdByRef/refsToIds
 * + os 3 estados de UI de clone/duplicate.
 *
 *   - create/inline×4/save: optimistic via taskMutate (cancela por chave).
 *   - handleCreateTask abre o sheet via setSelectedTaskRef (chamado de 2 sites).
 *   - AC×4 (create/update/toggle/delete): optimistic granular via
 *     acRowsCollection + resolveAcId + acIdAliasRef (alias temp-id → real-id).
 *     A ref mutável acIdAliasRef chega inteira (não .current).
 *   - clone/duplicate + bulk×5: fetch/loop + reload, ou taskMutate (bulk).
 *
 * Veja docs/platform/projects-page-refactor-runbook.md §4.3 e armadilha 5.
 */
export function useTaskActions(args: {
  id: string;
  supabase: ReturnType<typeof createClient>;
  tasks: AdaptedTask[];
  taskMutate: TaskMutate;
  loadTasksAndSprints: () => Promise<void>;
  stories: AdaptedStory[];
  rawMembers: RawMember[];
  project: ProjectMeta | null;
  projectTags: TaskTag[];
  setProjectTags: Dispatch<SetStateAction<TaskTag[]>>;
  acRowsCollection: AcCollection;
  resolveAcId: (clientId: string) => string;
  acIdAliasRef: MutableRefObject<Map<string, string>>;
  setConfirmState: (s: ConfirmState | null) => void;
  selectedTaskRef: string | null;
  setSelectedTaskRef: (ref: string | null) => void;
}) {
  const {
    id,
    supabase,
    tasks,
    taskMutate,
    loadTasksAndSprints,
    stories,
    rawMembers,
    project,
    projectTags,
    setProjectTags,
    acRowsCollection,
    resolveAcId,
    acIdAliasRef,
    setConfirmState,
    selectedTaskRef,
    setSelectedTaskRef,
  } = args;

  const [duplicateTaskRef, setDuplicateTaskRef] = useState<string | null>(null);
  const [cloneTaskRef, setCloneTaskRef] = useState<string | null>(null);
  const [targetProjects, setTargetProjects] = useState<ProjectLite[]>([]);

  /**
   * Create a backlog task and open the unified TaskSheet on it. The sheet
   * persists each field inline (saved on blur via the inline mutators), so
   * there's no "create form" — the user just edits the new task. The task
   * appears in the list immediately; if it was a misclick, the user deletes
   * via the row's kebab menu like any other task.
   *
   * `status="draft"` is reserved for AI-proposed tasks pending human review
   * (revealed only inside the originating Design Session), and is set
   * explicitly by that flow — never by this manual button.
   */
  async function handleCreateTask(opts?: {
    userStoryId?: string | null;
    sprintId?: string | null;
  }) {
    const tempTaskId = makeTempId("task");
    const now = new Date().toISOString();
    const optimistic: RawTask = {
      id: tempTaskId,
      reference: "…",
      title: "Nova task",
      description: null,
      status: "backlog",
      type: "feature",
      scope: "small",
      complexity: "medium",
      functionPoints: suggestFunctionPoints("small", "medium"),
      billable: true,
      dueDate: null,
      doneAt: null,
      notes: null,
      sprintId: opts?.sprintId ?? null,
      userStoryId: opts?.userStoryId ?? null,
      projectId: id,
      createdByAgent: false,
      assignments: [],
      tags: [],
    } as unknown as RawTask;

    const result = await taskMutate(
      { type: "create", entity: optimistic },
      async (signal) => {
        const res = await fetchOrThrow("/api/tasks", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            projectId: id,
            title: "Nova task",
            type: "feature",
            scope: "small",
            complexity: "medium",
            status: "backlog",
            userStoryId: opts?.userStoryId ?? null,
            sprintId: opts?.sprintId ?? null,
            functionPoints: suggestFunctionPoints("small", "medium"),
            billable: true,
            updatedAt: now,
          }),
          signal,
        });
        return (await res.json()) as RawTask & { id: string };
      },
      {
        errorLabel: "Falha ao criar task",
        reconcile: (prev, server) => {
          const without = prev.filter((t) => t.id !== tempTaskId);
          return [server, ...without];
        },
      },
    );

    if (result?.reference) {
      setSelectedTaskRef(result.reference);
    }
  }

  async function handleCreateTag(name: string, tone: ChipTone): Promise<TaskTag> {
    const res = await fetch(`/api/projects/${id}/tags`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, tone }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || "Falha ao criar tag");
    }
    const created = (await res.json()) as TaskTag;
    setProjectTags((cur) =>
      [...cur, created].sort((a, b) => a.name.localeCompare(b.name)),
    );
    return created;
  }

  async function handleChangeTaskTags(taskRef: string, tagIds: string[]) {
    const taskId = findTaskIdByRef(taskRef);
    if (!taskId) return;
    const res = await fetch(`/api/tasks/${taskId}/tags`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tagIds }),
    });
    if (!res.ok) {
      showErrorToast(new Error("Falha ao atualizar tags"), {
        label: "Tags",
      });
      return;
    }
    await loadTasksAndSprints();
  }

  /** Inline edits from the TasksList row. taskRef is the public reference;
   *  resolve to id via current `tasks` state (adapter exposes __id). */
  function findTaskIdByRef(ref: string): string | null {
    return tasks.find((t) => t.reference === ref)?.__id ?? null;
  }

  async function handleInlineStatusChange(
    taskRef: string,
    status: AdaptedTask["status"],
  ) {
    const taskId = findTaskIdByRef(taskRef);
    if (!taskId) return;
    await taskMutate(
      { type: "patch", id: taskId, patch: { status } },
      async (signal) => {
        const res = await fetchOrThrow(`/api/tasks/${taskId}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ status }),
          signal,
        });
        return (await res.json()) as RawTask;
      },
      {
        errorLabel: "Falha ao atualizar status",
        reconcile: (prev, server) =>
          prev.map((t) => (t.id === taskId ? { ...t, ...server } : t)),
      },
    );
  }

  async function handleInlineSprintChange(
    taskRef: string,
    sprintId: string | null,
  ) {
    const taskId = findTaskIdByRef(taskRef);
    if (!taskId) return;
    await taskMutate(
      { type: "patch", id: taskId, patch: { sprintId } },
      async (signal) => {
        const res = await fetchOrThrow(`/api/tasks/${taskId}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sprintId }),
          signal,
        });
        return (await res.json()) as RawTask;
      },
      {
        errorLabel: "Falha ao atualizar sprint",
        reconcile: (prev, server) =>
          prev.map((t) => (t.id === taskId ? { ...t, ...server } : t)),
      },
    );
  }

  /** Sets a single assignee — replaces all existing TaskAssignment rows. */
  async function handleInlineAssigneeChange(
    taskRef: string,
    memberId: string | null,
  ) {
    return handleInlineAssigneesChange(taskRef, memberId ? [memberId] : []);
  }

  /** Sets the full assignee list for a task (delete-all + insert). */
  async function handleInlineAssigneesChange(
    taskRef: string,
    memberIds: string[],
  ) {
    const taskId = findTaskIdByRef(taskRef);
    if (!taskId) return;

    const memberLookup = new Map<string, { id: string; name: string }>(
      rawMembers.map((m) => [m.id, { id: m.id, name: m.name }]),
    );
    if (project?.pm && !memberLookup.has(project.pm.id)) {
      memberLookup.set(project.pm.id, {
        id: project.pm.id,
        name: project.pm.name,
      });
    }
    const optimisticAssignments = memberIds
      .map((memberId) => {
        const m = memberLookup.get(memberId);
        return m
          ? { memberId, member: { id: m.id, name: m.name } }
          : null;
      })
      .filter(
        (a): a is { memberId: string; member: { id: string; name: string } } =>
          a !== null,
      );

    await taskMutate(
      {
        type: "patch",
        id: taskId,
        patch: { assignments: optimisticAssignments } as Partial<RawTask>,
      },
      async (signal) => {
        const res = await fetchOrThrow(`/api/tasks/${taskId}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            assigneeIds: memberIds.map((memberId) => ({ memberId })),
          }),
          signal,
        });
        return (await res.json()) as RawTask;
      },
      {
        errorLabel: "Falha ao atribuir",
        reconcile: (prev, server) =>
          prev.map((t) => (t.id === taskId ? { ...t, ...server } : t)),
      },
    );
  }

  async function handleSaveTask(updated: AdaptedTask) {
    const userStoryId =
      updated.userStoryRef === null
        ? null
        : stories.find((s) => s.reference === updated.userStoryRef)?.__id ??
          null;

    const fieldsPatch: Partial<RawTask> = {
      title: updated.title,
      description: updated.description,
      notes: updated.notes,
      status: updated.status,
      type: updated.type,
      scope: updated.scope,
      complexity: updated.complexity,
      functionPoints: updated.functionPoints,
      billable: updated.billable,
      dueDate: updated.dueDate,
      userStoryId,
    };

    await taskMutate(
      { type: "patch", id: updated.__id, patch: fieldsPatch },
      async (signal) => {
        const res = await fetchOrThrow(`/api/tasks/${updated.__id}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(fieldsPatch),
          signal,
        });
        return (await res.json()) as RawTask;
      },
      {
        errorLabel: "Falha ao salvar task",
        reconcile: (prev, server) =>
          prev.map((t) => (t.id === updated.__id ? { ...t, ...server } : t)),
      },
    );
  }

  // ─── AC handlers (granular optimistic via acRowsCollection) ────────────────

  async function handleAcCreate(taskRef: string, text: string, order: number) {
    const taskId = findTaskIdByRef(taskRef);
    if (!taskId) return;
    const tempId = makeTempId("ac");
    const optimistic: AcceptanceCriterionRow = {
      id: tempId,
      taskId,
      userStoryId: null,
      text,
      order,
      checkedAt: null,
      checkedBy: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    } as AcceptanceCriterionRow;
    await acRowsCollection.mutate(
      { type: "create", entity: optimistic },
      async (signal) => {
        const res = await fetchOrThrow(
          `/api/tasks/${taskId}/acceptance`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ text, order }),
            signal,
          },
        );
        const data = (await res.json()) as {
          acceptance: AcceptanceCriterionRow;
        };
        acIdAliasRef.current.set(tempId, data.acceptance.id);
        return data.acceptance;
      },
      {
        errorLabel: "Falha ao criar critério",
        // Keep tempId as the row's id in client state so the React key stays
        // stable (no remount/flicker). Server fields are merged in; URL ops
        // resolve through `acIdAliasRef`.
        reconcile: (prev, server) => {
          const merged: AcceptanceCriterionRow = { ...server, id: tempId };
          const exists = prev.some((r) => r.id === tempId);
          return exists
            ? prev.map((r) => (r.id === tempId ? merged : r))
            : [...prev, merged];
        },
      },
    );
  }

  async function handleAcUpdateText(
    taskRef: string,
    acId: string,
    text: string,
  ) {
    const taskId = findTaskIdByRef(taskRef);
    if (!taskId) return;
    const realAcId = resolveAcId(acId);
    await acRowsCollection.mutate(
      {
        type: "patch",
        id: acId,
        patch: { text } as Partial<AcceptanceCriterionRow>,
      },
      async (signal) => {
        const res = await fetchOrThrow(
          `/api/tasks/${taskId}/acceptance/${realAcId}`,
          {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ text }),
            signal,
          },
        );
        return (await res.json()) as { acceptance: AcceptanceCriterionRow };
      },
      { errorLabel: "Falha ao salvar critério" },
    );
  }

  async function handleAcToggle(
    taskRef: string,
    acId: string,
    checked: boolean,
  ) {
    const taskId = findTaskIdByRef(taskRef);
    if (!taskId) return;
    const realAcId = resolveAcId(acId);
    const now = new Date().toISOString();
    await acRowsCollection.mutate(
      {
        type: "patch",
        id: acId,
        patch: {
          checkedAt: checked ? now : null,
        } as Partial<AcceptanceCriterionRow>,
      },
      async (signal) => {
        const res = await fetchOrThrow(
          `/api/tasks/${taskId}/acceptance/${realAcId}`,
          {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ checked }),
            signal,
          },
        );
        return (await res.json()) as { acceptance: AcceptanceCriterionRow };
      },
      { errorLabel: "Falha ao marcar critério" },
    );
  }

  async function handleAcDelete(taskRef: string, acId: string) {
    const taskId = findTaskIdByRef(taskRef);
    if (!taskId) return;
    const realAcId = resolveAcId(acId);
    await acRowsCollection.mutate(
      { type: "delete", id: acId },
      async (signal) => {
        await fetchOrThrow(
          `/api/tasks/${taskId}/acceptance/${realAcId}`,
          { method: "DELETE", signal },
        );
        acIdAliasRef.current.delete(acId);
        return realAcId;
      },
      { errorLabel: "Falha ao remover critério" },
    );
  }

  async function loadTargetProjects() {
    const { data, error } = await supabase
      .from("Project")
      .select("id, name")
      .neq("id", id)
      .order("name");
    if (error) {
      console.error("[loadTargetProjects]", error);
      setTargetProjects([]);
      return;
    }
    setTargetProjects((data ?? []) as ProjectLite[]);
  }

  function openDuplicateDialog(taskRef: string) {
    setDuplicateTaskRef(taskRef);
  }

  async function openCloneDialog(taskRef: string) {
    await loadTargetProjects();
    setCloneTaskRef(taskRef);
  }

  async function handleCopyTaskRef(taskRef: string) {
    try {
      await navigator.clipboard.writeText(taskRef);
    } catch {
      // ignore
    }
  }

  async function handleConfirmDuplicate(input: {
    sprintId: string | null;
    status: AdaptedTask["status"];
  }) {
    if (!duplicateTaskRef) return;
    const taskId = findTaskIdByRef(duplicateTaskRef);
    if (!taskId) return;
    const res = await fetch(`/api/tasks/${taskId}/duplicate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });
    if (!res.ok) {
      const msg = await res.text().catch(() => "Falha ao duplicar task");
      showErrorToast(new Error(msg), { label: "Duplicar task" });
      return;
    }
    const created = await res.json().catch(() => null);
    await loadTasksAndSprints();
    if (created?.reference) {
      setSelectedTaskRef(created.reference);
    }
  }

  async function handleConfirmClone(input: {
    targetProjectId: string;
    status: AdaptedTask["status"];
  }) {
    if (!cloneTaskRef) return;
    const taskId = findTaskIdByRef(cloneTaskRef);
    if (!taskId) return;
    const res = await fetch(`/api/tasks/${taskId}/clone`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });
    if (!res.ok) {
      const msg = await res.text().catch(() => "Falha ao clonar task");
      showErrorToast(new Error(msg), { label: "Clonar task" });
      return;
    }
    const data = await res.json().catch(() => null);
    const projectName = data?.targetProjectName ?? "outro projeto";
    const newRef = data?.task?.reference ?? "";
    toast.success(
      `Clonada para ${projectName}${newRef ? ` (${newRef})` : ""}.`,
    );
  }

  async function handleDeleteTask(taskRef: string) {
    const taskId = findTaskIdByRef(taskRef);
    if (!taskId) return;
    setConfirmState({
      title: `Deletar task ${taskRef}?`,
      confirmLabel: "Deletar",
      destructive: true,
      onConfirm: () => deleteTask(taskRef, taskId),
    });
  }

  async function deleteTask(taskRef: string, taskId: string) {
    if (selectedTaskRef === taskRef) setSelectedTaskRef(null);
    await taskMutate(
      { type: "delete", id: taskId },
      async (signal) => {
        const res = await fetchOrThrow(`/api/tasks/${taskId}`, {
          method: "DELETE",
          signal,
        });
        return (await res.json()) as { ok: true; id: string };
      },
      {
        errorLabel: "Falha ao deletar task",
        reconcile: (prev) => prev.filter((t) => t.id !== taskId),
      },
    );
  }

  function refsToIds(taskRefs: string[]): string[] {
    return taskRefs
      .map((ref) => findTaskIdByRef(ref))
      .filter((id): id is string => !!id);
  }

  async function handleBulkUpdate(
    taskRefs: string[],
    patch: {
      status?: AdaptedTask["status"];
      assigneeId?: string | null;
      sprintId?: string | null;
    },
  ) {
    const taskIds = refsToIds(taskRefs);
    if (taskIds.length === 0) return;

    const localPatch: Partial<RawTask> = {};
    if (patch.status !== undefined) localPatch.status = patch.status;
    if (patch.sprintId !== undefined) localPatch.sprintId = patch.sprintId;
    if (patch.assigneeId !== undefined) {
      const m = patch.assigneeId
        ? rawMembers.find((mem) => mem.id === patch.assigneeId)
        : null;
      localPatch.assignments = m
        ? [{ memberId: m.id, member: { id: m.id, name: m.name } }]
        : [];
    }

    await taskMutate(
      { type: "bulkPatch", ids: taskIds, patch: localPatch },
      async (signal) => {
        const res = await fetchOrThrow("/api/tasks/bulk", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ taskIds, action: "update", patch }),
          signal,
        });
        return (await res.json()) as { ids: string[] };
      },
      {
        errorLabel: "Falha ao atualizar em massa",
        reconcile: (prev) =>
          prev.map((t) =>
            taskIds.includes(t.id) ? { ...t, ...localPatch } : t,
          ),
      },
    );
  }

  async function handleBulkDelete(taskRefs: string[]) {
    const taskIds = refsToIds(taskRefs);
    if (taskIds.length === 0) return;
    if (selectedTaskRef && taskRefs.includes(selectedTaskRef)) {
      setSelectedTaskRef(null);
    }
    await taskMutate(
      { type: "bulkDelete", ids: taskIds },
      async (signal) => {
        const res = await fetchOrThrow("/api/tasks/bulk", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ taskIds, action: "delete" }),
          signal,
        });
        return (await res.json()) as { ids: string[] };
      },
      {
        errorLabel: "Falha ao deletar em massa",
        reconcile: (prev) => prev.filter((t) => !taskIds.includes(t.id)),
      },
    );
  }

  async function handleBulkDuplicate(taskRefs: string[]) {
    const taskIds = refsToIds(taskRefs);
    if (taskIds.length === 0) return;
    // Reuse single-task duplicate endpoint in a sequential loop. Bulk duplicate
    // dedicated endpoint can come later if this gets slow at >50 tasks.
    let failures = 0;
    for (const taskId of taskIds) {
      const res = await fetch(`/api/tasks/${taskId}/duplicate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sprintId: null }),
      });
      if (!res.ok) failures += 1;
    }
    if (failures > 0) {
      showErrorToast(
        new Error(
          `${failures} duplicação(ões) falharam de ${taskIds.length}.`,
        ),
        { label: "Bulk duplicate" },
      );
    }
    await loadTasksAndSprints();
  }

  async function handleBulkAddTag(taskRefs: string[], tagId: string) {
    const taskIds = refsToIds(taskRefs);
    if (taskIds.length === 0) return;
    const tag = projectTags.find((t) => t.id === tagId);
    if (!tag) return;

    await taskMutate(
      { type: "bulkPatch", ids: taskIds, patch: {} as Partial<RawTask> },
      async (signal) => {
        const res = await fetchOrThrow("/api/tasks/bulk", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            taskIds,
            action: "update",
            patch: { addTagIds: [tagId] },
          }),
          signal,
        });
        return (await res.json()) as {
          ids: string[];
          skippedDueToLimit?: string[];
        };
      },
      {
        errorLabel: "Falha ao adicionar tag",
        reconcile: (prev, server) => {
          const skipped = new Set(server.skippedDueToLimit ?? []);
          if (skipped.size > 0) {
            const n = skipped.size;
            showErrorToast(
              new Error(
                `${n} task${n > 1 ? "s" : ""} não recebe${n > 1 ? "ram" : "u"} a tag (limite de 10).`,
              ),
              { label: "Limite de tags" },
            );
          }
          return prev.map((t) => {
            if (!taskIds.includes(t.id) || skipped.has(t.id)) return t;
            const has = t.tags.some((tg) => tg.id === tagId);
            if (has) return t;
            return { ...t, tags: [...t.tags, tag] };
          });
        },
      },
    );
  }

  async function handleBulkRemoveTag(taskRefs: string[], tagId: string) {
    const taskIds = refsToIds(taskRefs);
    if (taskIds.length === 0) return;
    await taskMutate(
      { type: "bulkPatch", ids: taskIds, patch: {} as Partial<RawTask> },
      async (signal) => {
        const res = await fetchOrThrow("/api/tasks/bulk", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            taskIds,
            action: "update",
            patch: { removeTagIds: [tagId] },
          }),
          signal,
        });
        return (await res.json()) as { ids: string[] };
      },
      {
        errorLabel: "Falha ao remover tag",
        reconcile: (prev) =>
          prev.map((t) =>
            taskIds.includes(t.id)
              ? {
                  ...t,
                  tags: t.tags.filter((tg) => tg.id !== tagId),
                }
              : t,
          ),
      },
    );
  }

  return {
    duplicateTaskRef,
    setDuplicateTaskRef,
    cloneTaskRef,
    setCloneTaskRef,
    targetProjects,
    setTargetProjects,
    findTaskIdByRef,
    handleCreateTask,
    handleCreateTag,
    handleChangeTaskTags,
    handleInlineStatusChange,
    handleInlineSprintChange,
    handleInlineAssigneeChange,
    handleInlineAssigneesChange,
    handleSaveTask,
    handleAcCreate,
    handleAcUpdateText,
    handleAcToggle,
    handleAcDelete,
    loadTargetProjects,
    openDuplicateDialog,
    openCloneDialog,
    handleCopyTaskRef,
    handleConfirmDuplicate,
    handleConfirmClone,
    handleDeleteTask,
    deleteTask,
    handleBulkUpdate,
    handleBulkDelete,
    handleBulkDuplicate,
    handleBulkAddTag,
    handleBulkRemoveTag,
  };
}
