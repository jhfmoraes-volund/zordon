"use client";

// StorySheetByRef — open the rich story-hierarchy StorySheet from anywhere
// (Design Sessions briefing tree, review page) given only a story reference.
// Mirrors the pattern in task-sheet-by-ref.tsx: loads the project context on
// demand, adapts DB rows to component types via the shared adapters, and wires
// the same mutation handlers used inside the project page.

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import {
  ResponsiveSheet,
  ResponsiveSheetContent,
} from "@/components/ui/responsive-sheet";
import { StorySheet } from "@/components/story-hierarchy/story-sheet";
import { showErrorToast } from "@/lib/optimistic/toast";
import {
  adaptModule,
  adaptPersona,
  adaptStory,
  adaptTask,
  buildTaskAdapterContext,
  type AdaptedStory,
  type AdaptedTask,
} from "@/components/story-hierarchy/adapters";
import type {
  AcceptanceCriterionRow,
  ModuleRow,
  PersonaRow,
  StoryWithRelations,
} from "@/lib/dal/story-hierarchy";
import { createClient } from "@/lib/supabase/client";
import { suggestFunctionPoints } from "@/lib/function-points";
import { flattenTagEmbed } from "@/lib/task-tags";

type Ctx = {
  story: AdaptedStory;
  tasks: AdaptedTask[];
  modules: ReturnType<typeof adaptModule>[];
  personas: ReturnType<typeof adaptPersona>[];
  definitionOfDone: string[];
  projectId: string;
};

type Props = {
  storyRef: string | null;
  onClose: () => void;
  onAfterChange?: () => void;
  /** Open a Task sheet from inside the Story sheet's task list. */
  onOpenTask?: (taskRef: string) => void;
};

export function StorySheetByRef({
  storyRef,
  onClose,
  onAfterChange,
  onOpenTask,
}: Props) {
  return (
    <StorySheetByRefInner
      key={storyRef ?? "closed"}
      storyRef={storyRef}
      onClose={onClose}
      onAfterChange={onAfterChange}
      onOpenTask={onOpenTask}
    />
  );
}

function StorySheetByRefInner({ storyRef, onClose, onAfterChange, onOpenTask }: Props) {
  const [ctx, setCtx] = useState<Ctx | null>(null);
  const [loading, setLoading] = useState(storyRef !== null);
  const supabase = createClient();
  const router = useRouter();

  const load = useCallback(
    async (ref: string): Promise<Ctx | null> => {
      const { data: storyRow, error: storyErr } = await supabase
        .from("UserStory")
        .select(
          "*, acceptanceCriteria:AcceptanceCriterion!AcceptanceCriterion_userStoryId_fkey(*), module:Module(id, name, description), persona:ProjectPersona(id, name, description)",
        )
        .eq("reference", ref)
        .single();
      if (storyErr || !storyRow) return null;
      const projectId = (storyRow as { projectId: string }).projectId;

      const [
        projectRes,
        modulesRes,
        personasRes,
        storiesRes,
        tasksRes,
        taskAcRes,
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
          .from("ProjectPersona")
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
          .from("Task")
          .select(
            "*, assignments:TaskAssignment(memberId, member:Member(id, name)), tags:TaskTagAssignment(TaskTag(id, projectId, name, tone))",
          )
          .eq("projectId", projectId),
        supabase
          .from("AcceptanceCriterion")
          .select("*")
          .not("taskId", "is", null),
      ]);

      const allStories = ((storiesRes.data ?? []) as unknown as StoryWithRelations[]).map(
        adaptStory,
      );
      const story =
        allStories.find((s) => s.reference === ref) ??
        adaptStory(storyRow as unknown as StoryWithRelations);

      const acRows = (taskAcRes.data ?? []) as AcceptanceCriterionRow[];
      const adapterCtx = buildTaskAdapterContext(allStories, acRows);
      const flatTasks = (tasksRes.data ?? []).map((t) => ({
        ...t,
        tags: flattenTagEmbed(
          (t as { tags?: Parameters<typeof flattenTagEmbed>[0] }).tags,
        ),
      }));
      const tasks = (flatTasks as Parameters<typeof adaptTask>[0][]).map((t) =>
        adaptTask(t, adapterCtx),
      );

      const modules = (modulesRes.data ?? []).map((r) => adaptModule(r as ModuleRow));
      const personas = (personasRes.data ?? []).map((r) => adaptPersona(r as PersonaRow));

      const project = projectRes.data;
      const definitionOfDone = Array.isArray(project?.definitionOfDone)
        ? (project.definitionOfDone as string[])
        : [];

      return { story, tasks, modules, personas, definitionOfDone, projectId };
    },
    [supabase],
  );

  useEffect(() => {
    if (storyRef === null) return;
    let cancelled = false;
    setLoading(true);
    load(storyRef)
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
  }, [storyRef, load]);

  // Refresh just the story (and its AC) after a mutation.
  const refreshStory = useCallback(async () => {
    if (!ctx || !storyRef) return;
    const { data: storyRow } = await supabase
      .from("UserStory")
      .select(
        "*, acceptanceCriteria:AcceptanceCriterion!AcceptanceCriterion_userStoryId_fkey(*), module:Module(id, name, description), persona:ProjectPersona(id, name, description)",
      )
      .eq("reference", storyRef)
      .single();
    if (!storyRow) return;
    const story = adaptStory(storyRow as unknown as StoryWithRelations);
    setCtx((cur) => (cur ? { ...cur, story } : cur));
    onAfterChange?.();
  }, [ctx, storyRef, supabase, onAfterChange]);

  const refreshTasks = useCallback(async () => {
    if (!ctx) return;
    const { data: tasksRes } = await supabase
      .from("Task")
      .select(
        "*, assignments:TaskAssignment(memberId, member:Member(id, name)), tags:TaskTagAssignment(TaskTag(id, projectId, name, tone))",
      )
      .eq("projectId", ctx.projectId);
    const { data: taskAcRes } = await supabase
      .from("AcceptanceCriterion")
      .select("*")
      .not("taskId", "is", null);
    const acRows = (taskAcRes ?? []) as AcceptanceCriterionRow[];
    const adapterCtx = buildTaskAdapterContext(
      // include the current story so adapter has context
      [ctx.story],
      acRows,
    );
    const flatTasks = (tasksRes ?? []).map((t) => ({
      ...t,
      tags: flattenTagEmbed(
        (t as { tags?: Parameters<typeof flattenTagEmbed>[0] }).tags,
      ),
    }));
    const tasks = (flatTasks as Parameters<typeof adaptTask>[0][]).map((t) =>
      adaptTask(t, adapterCtx),
    );
    setCtx((cur) => (cur ? { ...cur, tasks } : cur));
    onAfterChange?.();
  }, [ctx, supabase, onAfterChange]);

  // ─── Mutations ─────────────────────────────────────────────────────────────

  const handlePatch = useCallback(
    async (patch: Partial<AdaptedStory>) => {
      if (!ctx) return;
      const ref = ctx.story.reference;
      // Optimistic apply — the user sees their edit immediately, no flicker
      // while the PATCH round-trips. On failure, refetch restores the truth.
      setCtx((cur) =>
        cur ? { ...cur, story: { ...cur.story, ...patch } } : cur,
      );
      try {
        const res = await fetch(`/api/stories/${ref}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(patch),
        });
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          throw new Error(err.error || "Falha ao salvar story");
        }
        onAfterChange?.();
      } catch (e) {
        showErrorToast(e, { label: "Falha ao salvar story" });
        await refreshStory();
      }
    },
    [ctx, refreshStory, onAfterChange],
  );

  const handleApproveProposedModule = useCallback(
    async (s: AdaptedStory) => {
      try {
        const res = await fetch(
          `/api/stories/${s.reference}/promote-proposed-module`,
          { method: "POST" },
        );
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          throw new Error(err.error || "Falha ao promover módulo");
        }
        await refreshStory();
      } catch (e) {
        showErrorToast(e, { label: "Promover módulo" });
      }
    },
    [refreshStory],
  );

  const handleValidateAc = useCallback(
    async (s: AdaptedStory) => {
      try {
        const res = await fetch(`/api/stories/${s.reference}/validate-ac`, {
          method: "POST",
        });
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          throw new Error(err.error || "Falha ao validar AC");
        }
        await refreshStory();
      } catch (e) {
        showErrorToast(e, { label: "Validar AC" });
      }
    },
    [refreshStory],
  );

  // ─── AC handlers (granular, server is source of truth — refetch story) ───
  const handleAcCreate = useCallback(
    async (ref: string, text: string, order: number) => {
      try {
        const res = await fetch(`/api/stories/${ref}/acceptance`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text, order }),
        });
        if (!res.ok) throw new Error("Falha ao criar critério");
        await refreshStory();
      } catch (e) {
        showErrorToast(e, { label: "Criar critério" });
      }
    },
    [refreshStory],
  );

  const handleAcUpdateText = useCallback(
    async (ref: string, acId: string, text: string) => {
      try {
        const res = await fetch(`/api/stories/${ref}/acceptance/${acId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text }),
        });
        if (!res.ok) throw new Error("Falha ao salvar critério");
        await refreshStory();
      } catch (e) {
        showErrorToast(e, { label: "Salvar critério" });
      }
    },
    [refreshStory],
  );

  const handleAcToggle = useCallback(
    async (ref: string, acId: string, checked: boolean) => {
      try {
        const res = await fetch(`/api/stories/${ref}/acceptance/${acId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ checked }),
        });
        if (!res.ok) throw new Error("Falha ao marcar critério");
        await refreshStory();
      } catch (e) {
        showErrorToast(e, { label: "Marcar critério" });
      }
    },
    [refreshStory],
  );

  const handleAcDelete = useCallback(
    async (ref: string, acId: string) => {
      try {
        const res = await fetch(`/api/stories/${ref}/acceptance/${acId}`, {
          method: "DELETE",
        });
        if (!res.ok) throw new Error("Falha ao remover critério");
        await refreshStory();
      } catch (e) {
        showErrorToast(e, { label: "Remover critério" });
      }
    },
    [refreshStory],
  );

  const handleCreateTaskForStory = useCallback(
    async () => {
      if (!ctx) return;
      try {
        const dbStoryId = (ctx.story as AdaptedStory & { __id?: string }).__id ?? null;
        const res = await fetch("/api/tasks", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            projectId: ctx.projectId,
            title: "Nova task",
            type: "feature",
            scope: "small",
            complexity: "medium",
            status: "backlog",
            userStoryId: dbStoryId,
            functionPoints: suggestFunctionPoints("small", "medium"),
            billable: true,
            updatedAt: new Date().toISOString(),
          }),
        });
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          throw new Error(err.error || "Falha ao criar task");
        }
        const created = (await res.json()) as { reference?: string };
        await refreshTasks();
        if (created.reference && onOpenTask) {
          onClose();
          onOpenTask(created.reference);
        }
        router.refresh();
      } catch (e) {
        showErrorToast(e, { label: "Criar task" });
      }
    },
    [ctx, onClose, onOpenTask, refreshTasks, router],
  );

  // ─── Render ────────────────────────────────────────────────────────────────

  const isOpen = storyRef !== null;

  if (!isOpen) return null;

  if (loading || !ctx) {
    return (
      <ResponsiveSheet open={isOpen} onOpenChange={(o) => !o && onClose()}>
        <ResponsiveSheetContent size="lg" showCloseButton={false}>
          <div className="flex h-40 items-center justify-center text-sm text-muted-foreground">
            <Loader2 className="mr-2 size-4 animate-spin" />
            Carregando story…
          </div>
        </ResponsiveSheetContent>
      </ResponsiveSheet>
    );
  }

  return (
    <StorySheet
      story={ctx.story}
      tasks={ctx.tasks}
      modules={ctx.modules}
      personas={ctx.personas}
      definitionOfDone={ctx.definitionOfDone}
      onClose={onClose}
      onPatch={(patch) => handlePatch(patch as Partial<AdaptedStory>)}
      onApproveProposedModule={(s) => handleApproveProposedModule(s as AdaptedStory)}
      onValidateAc={(s) => handleValidateAc(s as AdaptedStory)}
      onOpenTask={(taskRef) => {
        if (onOpenTask) {
          onClose();
          onOpenTask(taskRef);
        }
      }}
      onCreateTaskForStory={handleCreateTaskForStory}
      onAcCreate={handleAcCreate}
      onAcUpdateText={handleAcUpdateText}
      onAcToggle={handleAcToggle}
      onAcDelete={handleAcDelete}
    />
  );
}
