"use client";

// StorySheetByRef — open the rich story-hierarchy StorySheet from anywhere
// (Design Sessions briefing tree, review page) given only a story reference.
// Mirrors the pattern in task-sheet-by-ref.tsx: loads the project context on
// demand, adapts DB rows to component types via the shared adapters, and wires
// the same mutation handlers used inside the project page.

import { useCallback, useEffect, useState } from "react";
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
  const [editing, setEditing] = useState(false);
  const supabase = createClient();

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
            "*, assignments:TaskAssignment(memberId, member:Member(id, name)), tags:TaskTagAssignment(TaskTag(id, name, tone))",
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
      const tasks = ((tasksRes.data ?? []) as Parameters<typeof adaptTask>[0][]).map((t) =>
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

  // ─── Mutations ─────────────────────────────────────────────────────────────

  const handleSave = useCallback(
    async (updated: AdaptedStory) => {
      if (!ctx) return;
      try {
        const res = await fetch(`/api/stories/${updated.reference}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            title: updated.title,
            want: updated.want,
            soThat: updated.soThat,
            personaId: updated.personaId,
            moduleId: updated.moduleId,
            proposedModuleName: updated.proposedModuleName ?? null,
            refinementStatus: updated.refinementStatus,
          }),
        });
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          throw new Error(err.error || "Falha ao salvar story");
        }
        // Persist AC edits — story-sheet edit form mutates `acceptanceCriteria`
        // in-place. The PATCH above doesn't touch AC; we sync them via the
        // dedicated /acceptance endpoint.
        await syncAc(ctx.story, updated);
        await refreshStory();
        setEditing(false);
      } catch (e) {
        showErrorToast(e, { label: "Falha ao salvar story" });
      }
    },
    [ctx, refreshStory],
  );

  const handleApproveProposedModule = useCallback(
    async (s: AdaptedStory) => {
      try {
        const res = await fetch(`/api/stories/${s.reference}/approve-module`, {
          method: "POST",
        });
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          throw new Error(err.error || "Falha ao aprovar módulo");
        }
        await refreshStory();
      } catch (e) {
        showErrorToast(e, { label: "Aprovar módulo" });
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

  // ─── Render ────────────────────────────────────────────────────────────────

  const isOpen = storyRef !== null;

  if (!isOpen) return null;

  if (loading || !ctx) {
    return (
      <ResponsiveSheet open={isOpen} onOpenChange={(o) => !o && onClose()}>
        <ResponsiveSheetContent size="md" showCloseButton={false}>
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
      editing={editing}
      onClose={() => {
        setEditing(false);
        onClose();
      }}
      onEdit={() => setEditing(true)}
      onCancelEdit={() => setEditing(false)}
      onSave={(updated) => handleSave(updated as AdaptedStory)}
      onApproveProposedModule={(s) => handleApproveProposedModule(s as AdaptedStory)}
      onValidateAc={(s) => handleValidateAc(s as AdaptedStory)}
      onOpenTask={(taskRef) => {
        if (onOpenTask) {
          onClose();
          onOpenTask(taskRef);
        }
      }}
    />
  );
}

// ─── AC sync ────────────────────────────────────────────────────────────────
// The story-sheet edit form lets the user add/remove/edit AC rows locally.
// On Save, diff the original vs draft and call the granular endpoints.
async function syncAc(original: AdaptedStory, updated: AdaptedStory) {
  const originalById = new Map(original.acceptanceCriteria.map((a) => [a.id, a]));
  const updatedIds = new Set(
    updated.acceptanceCriteria.map((a) => a.id).filter((id) => !id.startsWith("ac-new-")),
  );

  const toCreate = updated.acceptanceCriteria.filter((a) => a.id.startsWith("ac-new-"));
  const toDelete = original.acceptanceCriteria.filter((a) => !updatedIds.has(a.id));
  const toUpdate = updated.acceptanceCriteria.filter((a) => {
    if (a.id.startsWith("ac-new-")) return false;
    const orig = originalById.get(a.id);
    if (!orig) return false;
    return orig.text !== a.text || orig.checked !== a.checked;
  });

  for (let i = 0; i < toCreate.length; i++) {
    const ac = toCreate[i];
    if (!ac.text.trim()) continue;
    await fetch(`/api/stories/${updated.reference}/acceptance`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        text: ac.text,
        order: original.acceptanceCriteria.length + i,
      }),
    });
  }
  for (const ac of toDelete) {
    await fetch(`/api/stories/${updated.reference}/acceptance/${ac.id}`, {
      method: "DELETE",
    });
  }
  for (const ac of toUpdate) {
    await fetch(`/api/stories/${updated.reference}/acceptance/${ac.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: ac.text, checked: ac.checked }),
    });
  }
}
