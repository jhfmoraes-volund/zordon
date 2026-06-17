"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type {
  RawMember,
  RawProjectMember,
  RawSprintMember,
} from "../_types";

/**
 * Carrega ProjectMember + Member + SprintMember de um projeto.
 *
 * SprintMember é dependente das sprints já carregadas — passar `sprintIds`
 * vazio se ainda não tem (hook só busca quando há ids).
 */
export function useProjectMembers(projectId: string, sprintIds: string[]) {
  const supabase = useMemo(() => createClient(), []);
  const [rawMembers, setRawMembers] = useState<RawMember[]>([]);
  const [rawProjectMembers, setRawProjectMembers] = useState<
    RawProjectMember[]
  >([]);
  const [rawSprintMembers, setRawSprintMembers] = useState<RawSprintMember[]>(
    [],
  );

  const reloadMembers = useCallback(async () => {
    const { data: pms, error } = await supabase
      .from("ProjectMember")
      .select(
        "memberId, fpAllocation, member:Member!ProjectMember_memberId_fkey(id, name, role, fpCapacity, photoStoragePath, photoUpdatedAt)",
      )
      .eq("projectId", projectId);
    if (error) {
      console.error("[useProjectMembers.reloadMembers]", error);
      return;
    }

    const projectMemberRows: RawProjectMember[] = (pms ?? []).map((pm) => ({
      memberId: pm.memberId,
      fpAllocation: pm.fpAllocation ?? 0,
    }));
    setRawProjectMembers(projectMemberRows);

    const memberRows: RawMember[] = (pms ?? [])
      .map((pm) => {
        const m = pm.member as RawMember | RawMember[] | null | undefined;
        if (!m) return null;
        return Array.isArray(m) ? (m[0] ?? null) : m;
      })
      .filter((m): m is RawMember => m !== null);
    setRawMembers(memberRows);
  }, [projectId, supabase]);

  const reloadSprintMembers = useCallback(async () => {
    if (sprintIds.length === 0) {
      setRawSprintMembers([]);
      return;
    }
    const { data: sm } = await supabase
      .from("SprintMember")
      .select("sprintId, memberId, fpAllocation")
      .in("sprintId", sprintIds);
    setRawSprintMembers((sm ?? []) as RawSprintMember[]);
  }, [supabase, sprintIds]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial fetch on mount
    reloadMembers();
  }, [reloadMembers]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- refetch when sprintIds change
    reloadSprintMembers();
  }, [reloadSprintMembers]);

  return {
    rawMembers,
    setRawMembers,
    rawProjectMembers,
    setRawProjectMembers,
    rawSprintMembers,
    setRawSprintMembers,
    reloadMembers,
    reloadSprintMembers,
  };
}
