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
        .select("member:Member!ProjectMember_memberId_fkey(id, name, role)")
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
      const before = ctx.task;
      const userStoryId =
        updated.userStoryRef === null
          ? null
          : ctx.stories.find((s) => s.reference === updated.userStoryRef)?.__id ??
            null;

      const { error } = await supabase
        .from("Task")
        .update({
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
        })
        .eq("id", updated.__id);
      if (error) {
        showErrorToast(new Error(error.message), {
          label: "Falha ao salvar task",
        });
        return;
      }

      // ─── AC diff ────────────────────────────────────────────────────────
      const beforeMap = new Map(before.acceptanceCriteria.map((ac) => [ac.id, ac]));
      const afterMap = new Map(updated.acceptanceCriteria.map((ac) => [ac.id, ac]));

      for (const id of beforeMap.keys()) {
        if (!afterMap.has(id)) {
          await fetch(`/api/tasks/${updated.__id}/acceptance/${id}`, {
            method: "DELETE",
          });
        }
      }
      for (const [id, after] of afterMap) {
        if (id.startsWith("ac-new-")) {
          await fetch(`/api/tasks/${updated.__id}/acceptance`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ text: after.text }),
          });
          continue;
        }
        const prev = beforeMap.get(id);
        if (!prev) continue;
        const textChanged = prev.text !== after.text;
        const checkedChanged = prev.checked !== after.checked;
        if (textChanged || checkedChanged) {
          await fetch(`/api/tasks/${updated.__id}/acceptance/${id}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              ...(textChanged ? { text: after.text } : {}),
              ...(checkedChanged ? { checked: after.checked } : {}),
            }),
          });
        }
      }

      await refreshTask();
    },
    [ctx, supabase, refreshTask],
  );

  const handleChangeSprint = useCallback(
    async (_taskRef: string, sprintId: string | null) => {
      if (!ctx) return;
      const { error } = await supabase
        .from("Task")
        .update({ sprintId, updatedAt: new Date().toISOString() })
        .eq("id", ctx.task.__id);
      if (error) {
        showErrorToast(new Error(error.message), {
          label: "Falha ao atualizar sprint",
        });
        return;
      }
      await refreshTask();
    },
    [ctx, supabase, refreshTask],
  );

  const handleChangeAssignees = useCallback(
    async (_taskRef: string, memberIds: string[]) => {
      if (!ctx) return;
      const taskId = ctx.task.__id;

      const { error: delErr } = await supabase
        .from("TaskAssignment")
        .delete()
        .eq("taskId", taskId);
      if (delErr) {
        showErrorToast(new Error(delErr.message), {
          label: "Falha ao limpar assignment",
        });
        return;
      }
      if (memberIds.length > 0) {
        const { error: insErr } = await supabase.from("TaskAssignment").insert(
          memberIds.map((memberId) => ({
            id: crypto.randomUUID(),
            taskId,
            memberId,
          })),
        );
        if (insErr) {
          showErrorToast(new Error(insErr.message), {
            label: "Falha ao atribuir",
          });
          return;
        }
      }
      await refreshTask();
    },
    [ctx, supabase, refreshTask],
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
        showErrorToast(new Error("Falha ao atualizar tags"), {
          label: "Tags",
        });
        return;
      }
      await refreshTask();
    },
    [ctx, refreshTask],
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
          />
        )}
      </ResponsiveSheetContent>
    </ResponsiveSheet>
  );
}
