"use client";

/**
 * Grid de projetos do cliente (RLS-safe) — fallback para quem NÃO é manager+.
 *
 * Era o corpo do antigo clients/[id]/projects/page.tsx. Usa o browser client
 * (RLS-enforced): builder só vê os projetos a que tem acesso. Manager+ vê o
 * board estratégico completo (ProjetosView, service_role) — o gate vive no
 * page.tsx, espelhando o requireMinLevel(MANAGER) do Overview org (D5: sem
 * regressão de segurança — não expor projetos via service_role pra builder).
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { createClient } from "@/lib/supabase/client";
import {
  ClientProjectCard,
  type ClientProject,
  type ProjectInsightSummary,
} from "@/components/clients/client-project-card";
import { useClientContext } from "@/app/(dashboard)/clients/[id]/_context/client-context";

export function ClientProjectsGrid() {
  const { clientId, canSeeInsights } = useClientContext();
  const supabase = useMemo(() => createClient(), []);
  const [projects, setProjects] = useState<ClientProject[]>([]);
  const [insights, setInsights] = useState<Record<string, ProjectInsightSummary>>(
    {},
  );
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const { data: projectsRes } = await supabase
      .from("Project")
      .select(
        "id, name, status, startDate, endDate, projectMembers:ProjectMember(memberId), taskCount:Task(count)",
      )
      .eq("clientId", clientId)
      .order("createdAt", { ascending: false });

    const mapped = ((projectsRes ?? []) as Array<{
      id: string;
      name: string;
      status: string;
      startDate: string | null;
      endDate: string | null;
      projectMembers: Array<{ memberId: string }>;
      taskCount: Array<{ count: number }>;
    }>).map((p) => ({
      id: p.id,
      name: p.name,
      status: p.status,
      startDate: p.startDate,
      endDate: p.endDate,
      memberCount: p.projectMembers?.length ?? 0,
      taskCount: p.taskCount?.[0]?.count ?? 0,
    }));
    setProjects(mapped);

    if (canSeeInsights && mapped.length > 0) {
      const { data: insightsRes } = await supabase
        .from("ProjectInsight")
        .select("projectId, generatedAt, relationalHealth, technicalHealth")
        .in(
          "projectId",
          mapped.map((p) => p.id),
        );
      const map: Record<string, ProjectInsightSummary> = {};
      for (const row of insightsRes ?? []) {
        if (!row.projectId) continue;
        map[row.projectId] = {
          generatedAt: row.generatedAt,
          relationalHealth: row.relationalHealth,
          technicalHealth: row.technicalHealth,
        };
      }
      setInsights(map);
    } else {
      setInsights({});
    }

    setLoading(false);
  }, [clientId, canSeeInsights, supabase]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- Intentional data loading pattern
    void load();
  }, [load]);

  if (loading) {
    return (
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        <Skeleton className="h-28" />
        <Skeleton className="h-28" />
        <Skeleton className="h-28" />
      </div>
    );
  }

  if (projects.length === 0) {
    return (
      <div className="surface p-6 text-center text-sm text-muted-foreground">
        Este cliente ainda não tem projetos.
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
      {projects.map((p) => (
        <ClientProjectCard
          key={p.id}
          project={p}
          insight={insights[p.id] ?? null}
        />
      ))}
    </div>
  );
}
