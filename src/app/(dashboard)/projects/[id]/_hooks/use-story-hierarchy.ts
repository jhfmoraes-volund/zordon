"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useOptimisticCollection } from "@/hooks/use-optimistic-collection";
import type {
  AcceptanceCriterionRow,
  ModuleRow,
  PersonaRow,
  StoryWithRelations,
} from "@/lib/dal/story-hierarchy";

/**
 * Carrega + mantém a hierarquia de stories de um projeto:
 *   Module → UserStory → AcceptanceCriterion (das stories)
 *   + AcceptanceCriterion (das tasks — `taskId IS NOT NULL`)
 *
 * Visibilidade de UserStory segue regra "tudo ou nada" da Design Session:
 * - Stories manuais (designSessionId IS NULL): sempre visíveis.
 * - Stories de DS: visíveis só se a sessão estiver `completed`.
 */
export function useStoryHierarchy(projectId: string) {
  const supabase = useMemo(() => createClient(), []);
  const [rawModules, setRawModules] = useState<ModuleRow[]>([]);
  const [rawPersonas, setRawPersonas] = useState<PersonaRow[]>([]);
  const [rawStories, setRawStories] = useState<StoryWithRelations[]>([]);
  const acRowsCollection = useOptimisticCollection<AcceptanceCriterionRow>([]);
  const taskAcRows = acRowsCollection.items;
  const setTaskAcRows = acRowsCollection.setCommitted;

  // Map client-side tempId → real DB id. Lets us keep the tempId as the React
  // key after the create resolves, avoiding a remount/flicker on the row.
  const acIdAliasRef = useRef<Map<string, string>>(new Map());
  const resolveAcId = useCallback(
    (clientId: string) => acIdAliasRef.current.get(clientId) ?? clientId,
    [],
  );

  const reload = useCallback(async () => {
    const [modulesRes, personasRes, storiesRes, taskAcRes] = await Promise.all([
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
          // designSession embed precisa do nome explícito da FK porque há
          // 2 relações UserStory↔DesignSession (FK direta `designSessionId` e
          // reverse via `DesignSession.briefingTargetStoryId`). PostgREST recusa
          // embed ambíguo (PGRST201) — sempre nomear UserStory_designSessionId_fkey.
          "*, acceptanceCriteria:AcceptanceCriterion!AcceptanceCriterion_userStoryId_fkey(*), module:Module(id, name, description, approvedAt), persona:ProjectPersona(id, name, description), designSession:DesignSession!UserStory_designSessionId_fkey(status)",
        )
        .eq("projectId", projectId)
        .order("createdAt", { ascending: false }),
      supabase
        .from("AcceptanceCriterion")
        .select("*")
        .not("taskId", "is", null),
    ]);

    setRawModules((modulesRes.data ?? []) as ModuleRow[]);
    setRawPersonas((personasRes.data ?? []) as PersonaRow[]);
    const visibleStories = (
      (storiesRes.data ?? []) as Array<
        StoryWithRelations & {
          designSessionId: string | null;
          designSession: { status: string } | null;
        }
      >
    ).filter((s) => {
      if (s.designSessionId === null) return true;
      return s.designSession?.status === "completed";
    });
    setRawStories(visibleStories as unknown as StoryWithRelations[]);
    setTaskAcRows((taskAcRes.data ?? []) as AcceptanceCriterionRow[]);
    // After a hard reload, all rows carry real ids — aliases are obsolete.
    acIdAliasRef.current.clear();
  }, [projectId, supabase, setTaskAcRows]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial fetch on mount
    reload();
  }, [reload]);

  return {
    rawModules,
    setRawModules,
    rawPersonas,
    setRawPersonas,
    rawStories,
    setRawStories,
    taskAcRows,
    setTaskAcRows,
    acRowsCollection,
    acIdAliasRef,
    resolveAcId,
    reload,
  };
}
