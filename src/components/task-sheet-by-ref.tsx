"use client";

// TaskSheetByRef — open the rich story-hierarchy TaskSheet from anywhere
// (Profile, Design Sessions) given only a task id. Loads the project context
// (modules, stories+AC, members, sprints, tags, DoD) on demand and wires up
// the same mutation handlers used inside the project page.

import { useCallback, useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import {
  ResponsiveSheet,
  ResponsiveSheetContent,
} from "@/components/ui/responsive-sheet";
import {
  TaskSheetInner,
  type TaskTag,
} from "@/components/story-hierarchy";
import { showErrorToast } from "@/lib/optimistic/toast";
import {
  adaptMember,
  adaptModule,
  adaptStory,
  adaptTask,
  buildTaskAdapterContext,
  type AdaptedStory,
  type AdaptedTask,
} from "@/components/story-hierarchy/adapters";
import type {
  AcceptanceCriterionRow,
  ModuleRow,
  StoryWithRelations,
} from "@/lib/dal/story-hierarchy";
import { createClient } from "@/lib/supabase/client";
import type { ChipTone } from "@/lib/status-chips";

type SprintLite = {
  id: string;
  name: string;
  status?: string;
};

type Ctx = {
  task: AdaptedTask;
  stories: AdaptedStory[];
  modules: ReturnType<typeof adaptModule>[];
  members: ReturnType<typeof adaptMember>[];
  sprints: SprintLite[];
  projectTags: TaskTag[];
  definitionOfDone: string[];
  projectId: string;
};

type Props = {
  taskId: string | null;
  onClose: () => void;
  /** Called after any successful mutation so the parent can refresh its list. */
  onAfterChange?: () => void;
};

export function TaskSheetByRef({ taskId, onClose, onAfterChange }: Props) {
  // Keyed inner: each new taskId remounts a fresh component with clean state.
  return (
    <TaskSheetByRefInner
      key={taskId ?? "closed"}
      taskId={taskId}
      onClose={onClose}
      onAfterChange={onAfterChange}
    />
  );
}

function TaskSheetByRefInner({ taskId, onClose, onAfterChange }: Props) {
  const [ctx, setCtx] = useState<Ctx | null>(null);
  const [loading, setLoading] = useState(taskId !== null);
  const supabase = createClient();

  const load = useCallback(async (id: string): Promise<Ctx | null> => {
    // Step 1 — find the task's project id.
    const { data: taskRow, error: taskErr } = await supabase
      .from("Task")
      .select("projectId")
      .eq("id", id)
      .single();
    if (taskErr || !taskRow) return null;
    const projectId = taskRow.projectId;

    // Step 2 — load project context in parallel.
    const [
      projectRes,
      modulesRes,
      storiesRes,
      taskAcRes,
      tasksRes,
      sprintsRes,
      tagsRes,
      membersRes,
    ] = await Promise.all([
      supabase
        .from("Project")
        .select("definitionOfDone")
        .eq("id", projectId)
        .single(),
      supabase
        .from("Module")
        .select("*")
        .eq("projectId", projectId)
        .order("name"),
      supabase
        .from("UserStory")
        .select(
          "*, acceptanceCriteria:AcceptanceCriterion!AcceptanceCriterion_userStoryId_fkey(*), module:Module(id, name, description), persona:ProjectPersona(id, name, description)",
        )
        .eq("projectId", projectId),
      supabase
        .from("AcceptanceCriterion")
        .select("*")
        .not("taskId", "is", null),
      supabase
        .from("Task")
        .select(
          "*, assignments:TaskAssignment(memberId, member:Member(id, name)), tags:TaskTagAssignment(TaskTag(id, name, tone))",
        )
        .eq("id", id)
        .single(),
      supabase
        .from("Sprint")
        .select("id, name, status")
        .eq("projectId", projectId)
        .order("startDate"),
      supabase
        .from("TaskTag")
        .select("id, name, tone")
        .eq("projectId", projectId)
        .order("name"),
      supabase
        .from("ProjectMember")
        .select("member:Member!ProjectMember_memberId_fkey(id, name, role, position)")
        .eq("projectId", projectId),
    ]);

    if (!tasksRes.data) return null;

    const modules = (modulesRes.data ?? []).map((r) => adaptModule(r as ModuleRow));
    const stories = ((storiesRes.data ?? []) as unknown as StoryWithRelations[]).map(
      adaptStory,
    );
    const acRows = (taskAcRes.data ?? []) as AcceptanceCriterionRow[];
    const adapterCtx = buildTaskAdapterContext(stories, acRows);
    const task = adaptTask(tasksRes.data as Parameters<typeof adaptTask>[0], adapterCtx);

    const memberRows = (membersRes.data ?? [])
      .map((pm) => {
        const m = pm.member as
          | { id: string; name: string; role: string | null }
          | { id: string; name: string; role: string | null }[]
          | null;
        return Array.isArray(m) ? m[0] ?? null : m;
      })
      .filter((m): m is { id: string; name: string; role: string | null } => m !== null);
    const members = memberRows.map((m) => adaptMember(m));

    const project = projectRes.data;
    const definitionOfDone = Array.isArray(project?.definitionOfDone)
      ? (project.definitionOfDone as string[])
      : [];

    return {
      task,
      stories,
      modules,
      members,
      sprints: (sprintsRes.data ?? []) as SprintLite[],
      projectTags: (tagsRes.data ?? []) as TaskTag[],
      definitionOfDone,
      projectId,
    };
  }, [supabase]);

  useEffect(() => {
    if (taskId === null) return;
    let cancelled = false;
    load(taskId)
      .then((c) => {
        if (cancelled) return;
        setCtx(c);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [taskId, load]);

  // Refresh just the task + AC after a mutation; keep the rest of the project
  // context intact so the sheet stays open.
  const refreshTask = useCallback(async () => {
    if (!ctx || !taskId) return;
    const [tasksRes, taskAcRes] = await Promise.all([
      supabase
        .from("Task")
        .select(
          "*, assignments:TaskAssignment(memberId, member:Member(id, name)), tags:TaskTagAssignment(TaskTag(id, name, tone))",
        )
        .eq("id", taskId)
        .single(),
      supabase
        .from("AcceptanceCriterion")
        .select("*")
        .not("taskId", "is", null),
    ]);
    if (!tasksRes.data) return;
    const acRows = (taskAcRes.data ?? []) as AcceptanceCriterionRow[];
    const adapterCtx = buildTaskAdapterContext(ctx.stories, acRows);
    const task = adaptTask(tasksRes.data as Parameters<typeof adaptTask>[0], adapterCtx);
    setCtx((cur) => (cur ? { ...cur, task } : cur));
    onAfterChange?.();
  }, [ctx, taskId, supabase, onAfterChange]);

  // ─── Mutations ─────────────────────────────────────────────────────────────

  const handleSave = useCallback(
    async (updated: AdaptedTask) => {
      if (!ctx) return;
      const userStoryId =
        updated.userStoryRef === null
          ? null
          : ctx.stories.find((s) => s.reference === updated.userStoryRef)?.__id ??
            null;

      const res = await fetch(`/api/tasks/${updated.__id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
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
          updatedAt: new Date().toISOString(),
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        showErrorToast(new Error(err.error || "Falha ao salvar task"), {
          label: "Falha ao salvar task",
        });
        return;
      }
      // Reflect updated fields locally without a full refetch.
      setCtx((cur) =>
        cur
          ? {
              ...cur,
              task: {
                ...cur.task,
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
                userStoryRef: updated.userStoryRef,
              },
            }
          : cur,
      );
      onAfterChange?.();
    },
    [ctx, onAfterChange],
  );

  const handleChangeSprint = useCallback(
    async (_taskRef: string, sprintId: string | null) => {
      if (!ctx) return;
      const res = await fetch(`/api/tasks/${ctx.task.__id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sprintId,
          updatedAt: new Date().toISOString(),
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        showErrorToast(new Error(err.error || "Falha ao atualizar sprint"), {
          label: "Falha ao atualizar sprint",
        });
        return;
      }
      await refreshTask();
    },
    [ctx, refreshTask],
  );

  const handleChangeAssignees = useCallback(
    async (_taskRef: string, memberIds: string[]) => {
      if (!ctx) return;
      const taskId = ctx.task.__id;

      const res = await fetch(`/api/tasks/${taskId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          assigneeIds: memberIds.map((memberId) => ({ memberId })),
          updatedAt: new Date().toISOString(),
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        showErrorToast(new Error(err.error || "Falha ao atribuir"), {
          label: "Falha ao atribuir",
        });
        return;
      }
      await refreshTask();
    },
    [ctx, refreshTask],
  );

  const handleCreateTag = useCallback(
    async (name: string, tone: ChipTone): Promise<TaskTag> => {
      if (!ctx) throw new Error("Project context not loaded");
      const res = await fetch(`/api/projects/${ctx.projectId}/tags`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, tone }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || "Falha ao criar tag");
      }
      const created = (await res.json()) as TaskTag;
      setCtx((cur) =>
        cur
          ? {
              ...cur,
              projectTags: [...cur.projectTags, created].sort((a, b) =>
                a.name.localeCompare(b.name),
              ),
            }
          : cur,
      );
      return created;
    },
    [ctx],
  );

  const handleChangeTags = useCallback(
    async (_taskRef: string, tagIds: string[]) => {
      if (!ctx) return;
      const res = await fetch(`/api/tasks/${ctx.task.__id}/tags`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tagIds }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        const error = new Error(err.error || "Falha ao atualizar tags");
        showErrorToast(error, { label: "Tags" });
        throw error;
      }
      const updated = (await res.json()) as Array<{
        id: string;
        name: string;
        tone: string;
      }>;
      const tags: TaskTag[] = updated.map((t) => ({
        id: t.id,
        name: t.name,
        tone: t.tone,
      }));
      setCtx((cur) =>
        cur ? { ...cur, task: { ...cur.task, tags } } : cur,
      );
      onAfterChange?.();
    },
    [ctx, onAfterChange],
  );

  // ─── AC granular handlers (optimistic apply via setCtx + rollback) ───────

  function patchAcInCtx(updater: (acs: AdaptedTask["acceptanceCriteria"]) => AdaptedTask["acceptanceCriteria"]) {
    setCtx((cur) =>
      cur
        ? {
            ...cur,
            task: {
              ...cur.task,
              acceptanceCriteria: updater(cur.task.acceptanceCriteria),
            },
          }
        : cur,
    );
  }

  const handleAcCreate = useCallback(
    async (_taskRef: string, text: string, order: number) => {
      if (!ctx) return;
      const taskDbId = ctx.task.__id;
      const tempId = `ac-tmp-${Date.now()}`;
      const draftAc: AdaptedTask["acceptanceCriteria"][number] = {
        id: tempId,
        text,
        checked: false,
      };
      patchAcInCtx((acs) => [...acs, draftAc]);
      try {
        const res = await fetch(`/api/tasks/${taskDbId}/acceptance`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text, order }),
        });
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          throw new Error(err.error || "Falha ao criar critério");
        }
        const data = (await res.json()) as {
          acceptance: { id: string; text: string; checkedAt: string | null };
        };
        patchAcInCtx((acs) =>
          acs.map((a) =>
            a.id === tempId
              ? {
                  id: data.acceptance.id,
                  text: data.acceptance.text,
                  checked: data.acceptance.checkedAt !== null,
                }
              : a,
          ),
        );
        onAfterChange?.();
      } catch (e) {
        patchAcInCtx((acs) => acs.filter((a) => a.id !== tempId));
        showErrorToast(e, { label: "Falha ao criar critério" });
      }
    },
    [ctx, onAfterChange],
  );

  const handleAcUpdateText = useCallback(
    async (_taskRef: string, acId: string, text: string) => {
      if (!ctx) return;
      const taskDbId = ctx.task.__id;
      const prev = ctx.task.acceptanceCriteria.find((a) => a.id === acId);
      if (!prev) return;
      patchAcInCtx((acs) =>
        acs.map((a) => (a.id === acId ? { ...a, text } : a)),
      );
      try {
        const res = await fetch(
          `/api/tasks/${taskDbId}/acceptance/${acId}`,
          {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ text }),
          },
        );
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          throw new Error(err.error || "Falha ao salvar critério");
        }
        onAfterChange?.();
      } catch (e) {
        patchAcInCtx((acs) =>
          acs.map((a) => (a.id === acId ? { ...a, text: prev.text } : a)),
        );
        showErrorToast(e, { label: "Falha ao salvar critério" });
      }
    },
    [ctx, onAfterChange],
  );

  const handleAcToggle = useCallback(
    async (_taskRef: string, acId: string, checked: boolean) => {
      if (!ctx) return;
      const taskDbId = ctx.task.__id;
      const prev = ctx.task.acceptanceCriteria.find((a) => a.id === acId);
      if (!prev) return;
      patchAcInCtx((acs) =>
        acs.map((a) => (a.id === acId ? { ...a, checked } : a)),
      );
      try {
        const res = await fetch(
          `/api/tasks/${taskDbId}/acceptance/${acId}`,
          {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ checked }),
          },
        );
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          throw new Error(err.error || "Falha ao marcar critério");
        }
        onAfterChange?.();
      } catch (e) {
        patchAcInCtx((acs) =>
          acs.map((a) => (a.id === acId ? { ...a, checked: prev.checked } : a)),
        );
        showErrorToast(e, { label: "Falha ao marcar critério" });
      }
    },
    [ctx, onAfterChange],
  );

  const handleAcDelete = useCallback(
    async (_taskRef: string, acId: string) => {
      if (!ctx) return;
      const taskDbId = ctx.task.__id;
      const prev = ctx.task.acceptanceCriteria.find((a) => a.id === acId);
      if (!prev) return;
      patchAcInCtx((acs) => acs.filter((a) => a.id !== acId));
      try {
        const res = await fetch(
          `/api/tasks/${taskDbId}/acceptance/${acId}`,
          { method: "DELETE" },
        );
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          throw new Error(err.error || "Falha ao remover critério");
        }
        onAfterChange?.();
      } catch (e) {
        patchAcInCtx((acs) => [...acs, prev]);
        showErrorToast(e, { label: "Falha ao remover critério" });
      }
    },
    [ctx, onAfterChange],
  );

  // ─── Render ────────────────────────────────────────────────────────────────

  const isOpen = taskId !== null;

  return (
    <ResponsiveSheet open={isOpen} onOpenChange={(o) => !o && onClose()}>
      <ResponsiveSheetContent size="lg" showCloseButton={false}>
        {loading || !ctx ? (
          <div className="flex h-full min-h-[200px] items-center justify-center p-12">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <TaskSheetInner
            task={ctx.task}
            stories={ctx.stories}
            modules={ctx.modules}
            members={ctx.members}
            sprints={ctx.sprints}
            definitionOfDone={ctx.definitionOfDone}
            availableTags={ctx.projectTags}
            onClose={onClose}
            onSave={(updated) => handleSave(updated as AdaptedTask)}
            onChangeSprint={handleChangeSprint}
            onChangeAssignees={handleChangeAssignees}
            onCreateTag={handleCreateTag}
            onChangeTags={handleChangeTags}
            onAcCreate={handleAcCreate}
            onAcUpdateText={handleAcUpdateText}
            onAcToggle={handleAcToggle}
            onAcDelete={handleAcDelete}
          />
        )}
      </ResponsiveSheetContent>
    </ResponsiveSheet>
  );
}
