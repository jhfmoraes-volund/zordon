"use client";

// Loader for the data the rich TaskSheet needs to render: project context
// (modules, stories+AC, members, sprints, tags, DoD) plus optionally a focused
// task. Extracted from `task-sheet-by-ref.tsx` so non-task-real callers
// (proposed CREATE actions in meetings) can use the same context shape.

import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import {
  adaptMember,
  adaptModule,
  adaptStory,
  adaptTask,
  buildTaskAdapterContext,
  type AdaptedStory,
  type AdaptedTask,
} from "./adapters";
import type {
  AcceptanceCriterionRow,
  ModuleRow,
  StoryWithRelations,
} from "@/lib/dal/story-hierarchy";
import { flattenTagEmbed, type TaskTag } from "@/lib/task-tags";

type SprintLite = { id: string; name: string; status?: string };

export type TaskSheetProjectContext = {
  projectId: string;
  stories: AdaptedStory[];
  modules: ReturnType<typeof adaptModule>[];
  members: ReturnType<typeof adaptMember>[];
  sprints: SprintLite[];
  projectTags: TaskTag[];
  definitionOfDone: string[];
};

export type TaskSheetContext = TaskSheetProjectContext & {
  task: AdaptedTask | null;
};

export type UseTaskSheetContextOptions =
  | { mode: "byTask"; taskId: string | null }
  | { mode: "byProject"; projectId: string | null };

type Result = {
  ctx: TaskSheetContext | null;
  loading: boolean;
  /** Reload the *task* portion (and re-derive AC). Project context stays. */
  refreshTask: () => Promise<void>;
  /** Replace the loaded task in-place (no fetch). For optimistic updates. */
  patchTask: (patch: Partial<AdaptedTask>) => void;
  /** Replace projectTags after creating a tag in-flight. */
  setProjectTags: (next: TaskTag[]) => void;
};

export function useTaskSheetContext(opts: UseTaskSheetContextOptions): Result {
  const supabase = createClient();
  const [ctx, setCtx] = useState<TaskSheetContext | null>(null);
  const [loading, setLoading] = useState(true);

  const loadProject = useCallback(
    async (projectId: string): Promise<TaskSheetProjectContext | null> => {
      const [
        projectRes,
        modulesRes,
        storiesRes,
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
          .from("Sprint")
          .select("id, name, status")
          .eq("projectId", projectId)
          .order("startDate"),
        supabase
          .from("TaskTag")
          .select("id, projectId, name, tone")
          .eq("projectId", projectId)
          .order("name"),
        supabase
          .from("ProjectMember")
          .select("member:Member!ProjectMember_memberId_fkey(id, name, role, position)")
          .eq("projectId", projectId),
      ]);

      const modules = (modulesRes.data ?? []).map((r) => adaptModule(r as ModuleRow));
      const stories = ((storiesRes.data ?? []) as unknown as StoryWithRelations[]).map(
        adaptStory,
      );
      const memberRows = (membersRes.data ?? [])
        .map((pm) => {
          const m = pm.member as
            | { id: string; name: string; role: string | null }
            | { id: string; name: string; role: string | null }[]
            | null;
          return Array.isArray(m) ? m[0] ?? null : m;
        })
        .filter((m): m is { id: string; name: string; role: string | null } => !!m);
      const members = memberRows.map((m) => adaptMember(m));

      const project = projectRes.data;
      const definitionOfDone = Array.isArray(project?.definitionOfDone)
        ? (project.definitionOfDone as string[])
        : [];

      return {
        projectId,
        stories,
        modules,
        members,
        sprints: (sprintsRes.data ?? []) as SprintLite[],
        projectTags: (tagsRes.data ?? []) as TaskTag[],
        definitionOfDone,
      };
    },
    [supabase],
  );

  const loadTask = useCallback(
    async (taskId: string, stories: AdaptedStory[]): Promise<AdaptedTask | null> => {
      const [taskRes, taskAcRes] = await Promise.all([
        supabase
          .from("Task")
          .select(
            "*, assignments:TaskAssignment(memberId, member:Member(id, name)), tags:TaskTagAssignment(TaskTag(id, projectId, name, tone))",
          )
          .eq("id", taskId)
          .single(),
        supabase
          .from("AcceptanceCriterion")
          .select("*")
          .not("taskId", "is", null),
      ]);
      if (!taskRes.data) return null;
      const acRows = (taskAcRes.data ?? []) as AcceptanceCriterionRow[];
      const adapterCtx = buildTaskAdapterContext(stories, acRows);
      const flatTask = {
        ...taskRes.data,
        tags: flattenTagEmbed(
          (taskRes.data as { tags?: Parameters<typeof flattenTagEmbed>[0] }).tags,
        ),
      };
      return adaptTask(flatTask as Parameters<typeof adaptTask>[0], adapterCtx);
    },
    [supabase],
  );

  // Effect — initial load
  useEffect(() => {
    let cancelled = false;
    setLoading(true);

    const run = async () => {
      if (opts.mode === "byTask") {
        if (!opts.taskId) {
          setCtx(null);
          return;
        }
        const { data: row } = await supabase
          .from("Task")
          .select("projectId")
          .eq("id", opts.taskId)
          .single();
        if (cancelled) return;
        if (!row) {
          setCtx(null);
          return;
        }
        const project = await loadProject(row.projectId);
        if (cancelled || !project) {
          if (!cancelled) setCtx(null);
          return;
        }
        const task = await loadTask(opts.taskId, project.stories);
        if (cancelled) return;
        setCtx({ ...project, task });
      } else {
        if (!opts.projectId) {
          setCtx(null);
          return;
        }
        const project = await loadProject(opts.projectId);
        if (cancelled) return;
        setCtx(project ? { ...project, task: null } : null);
      }
    };

    run().finally(() => {
      if (!cancelled) setLoading(false);
    });

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    opts.mode,
    opts.mode === "byTask" ? opts.taskId : null,
    opts.mode === "byProject" ? opts.projectId : null,
  ]);

  const refreshTask = useCallback(async () => {
    if (!ctx) return;
    if (opts.mode !== "byTask" || !opts.taskId) return;
    const task = await loadTask(opts.taskId, ctx.stories);
    setCtx((cur) => (cur ? { ...cur, task } : cur));
  }, [ctx, opts, loadTask]);

  const patchTask = useCallback((patch: Partial<AdaptedTask>) => {
    setCtx((cur) =>
      cur && cur.task ? { ...cur, task: { ...cur.task, ...patch } } : cur,
    );
  }, []);

  const setProjectTags = useCallback((next: TaskTag[]) => {
    setCtx((cur) => (cur ? { ...cur, projectTags: next } : cur));
  }, []);

  return { ctx, loading, refreshTask, patchTask, setProjectTags };
}
