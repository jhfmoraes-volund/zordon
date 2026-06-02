"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useOptimisticCollection } from "@/hooks/use-optimistic-collection";
import { flattenTagEmbed } from "@/lib/task-tags";
import type { TaskTag } from "@/components/story-hierarchy";
import type { RawSprint, RawTask } from "../_types";

/**
 * Carrega Task (não-draft) + Sprint + TaskTag de um projeto.
 *
 * Tasks vivem em useOptimisticCollection — handlers chamam `taskMutate(...)`
 * com optimistic + reconcile. Sprints e tags usam setState simples (mutações
 * menos frequentes, refresca via `reload`).
 */
export function useTasksAndSprints(projectId: string) {
  const supabase = useMemo(() => createClient(), []);
  const tasksCollection = useOptimisticCollection<RawTask>([]);
  const rawTasks = tasksCollection.items;
  const setRawTasks = tasksCollection.setCommitted;
  const taskMutate = tasksCollection.mutate;

  const [rawSprints, setRawSprints] = useState<RawSprint[]>([]);
  const [projectTags, setProjectTags] = useState<TaskTag[]>([]);

  const reload = useCallback(async () => {
    const [tasksRes, sprintsRes, tagsRes] = await Promise.all([
      supabase
        .from("Task")
        .select(
          "*, assignments:TaskAssignment(memberId, member:Member(id, name)), tags:TaskTagAssignment(TaskTag(id, projectId, name, tone))",
        )
        .eq("projectId", projectId)
        .neq("status", "draft")
        .is("dismissedAt", null)
        .order("createdAt", { ascending: false }),
      supabase
        .from("Sprint")
        .select("*")
        .eq("projectId", projectId)
        .order("startDate"),
      supabase
        .from("TaskTag")
        .select("id, projectId, name, tone")
        .eq("projectId", projectId)
        .order("name"),
    ]);
    const flatTasks = (tasksRes.data ?? []).map((t) => ({
      ...t,
      tags: flattenTagEmbed(
        (t as { tags?: Parameters<typeof flattenTagEmbed>[0] }).tags,
      ),
    }));
    setRawTasks(flatTasks as unknown as RawTask[]);
    setRawSprints((sprintsRes.data ?? []) as RawSprint[]);
    setProjectTags((tagsRes.data ?? []) as TaskTag[]);
  }, [projectId, supabase, setRawTasks]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial fetch on mount
    reload();
  }, [reload]);

  return {
    rawTasks,
    setRawTasks,
    taskMutate,
    tasksCollection,
    rawSprints,
    setRawSprints,
    projectTags,
    setProjectTags,
    reload,
  };
}
