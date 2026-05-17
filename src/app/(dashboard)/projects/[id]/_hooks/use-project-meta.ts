"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { ProjectMeta } from "../_types";

export function useProjectMeta(projectId: string) {
  const supabase = useMemo(() => createClient(), []);
  const [project, setProject] = useState<ProjectMeta | null>(null);

  const reload = useCallback(async () => {
    const { data } = await supabase
      .from("Project")
      .select(
        "id, name, status, clientId, pmId, repoUrl, startDate, endDate, githubRepoOwner, githubRepoName, githubDefaultBranch, referenceKey, definitionOfDone, client:Client(name), pm:Member!Project_pmId_fkey(id, name, role, fpCapacity)",
      )
      .eq("id", projectId)
      .single();
    if (!data) return;
    setProject({
      id: data.id,
      name: data.name,
      status: data.status,
      client: (data.client as { name: string } | null) ?? null,
      clientId: data.clientId,
      pmId: data.pmId ?? null,
      pm:
        (data.pm as {
          id: string;
          name: string;
          role: string | null;
          fpCapacity: number | null;
        } | null) ?? null,
      repoUrl: data.repoUrl ?? null,
      startDate: data.startDate ?? null,
      endDate: data.endDate ?? null,
      githubRepoOwner: data.githubRepoOwner ?? null,
      githubRepoName: data.githubRepoName ?? null,
      githubDefaultBranch: data.githubDefaultBranch ?? null,
      referenceKey: data.referenceKey ?? null,
      definitionOfDone: Array.isArray(data.definitionOfDone)
        ? (data.definitionOfDone as string[])
        : [],
    });
  }, [projectId, supabase]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial fetch on mount
    reload();
  }, [reload]);

  return { project, reload, setProject };
}
