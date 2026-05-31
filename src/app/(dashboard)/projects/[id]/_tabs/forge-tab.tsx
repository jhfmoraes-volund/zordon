"use client";

import { useCallback, useEffect, useState } from "react";
import { GitBranch } from "lucide-react";
import { ForgeProjectCard } from "@/components/forge/forge-project-card";
import { ActiveBuilders } from "@/components/forge/active-builders";
import { NoBuildersBanner } from "@/components/forge/no-builders-banner";
import { GitHubRepoModal } from "@/components/planning/github-repo-modal";
import { Button } from "@/components/ui/button";
import type { ProjectForgeSummary } from "@/lib/dal/forge-project";

type ProjectInfo = {
  id: string;
  name: string;
  referenceKey: string | null;
  repoUrl: string | null;
  githubRepoOwner: string | null;
  githubRepoName: string | null;
  githubDefaultBranch: string | null;
};

export function ForgeTab({ projectId }: { projectId: string }) {
  const [project, setProject] = useState<ProjectInfo | null>(null);
  const [summary, setSummary] = useState<ProjectForgeSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [repoModalOpen, setRepoModalOpen] = useState(false);

  const reload = useCallback(async () => {
    try {
      const r = await fetch(`/api/forge/projects/${projectId}/summary`, {
        cache: "no-store",
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const data = await r.json();
      setProject(data.project);
      setSummary(data.summary);
      setError(null);
    } catch (err) {
      setError(String(err));
    }
  }, [projectId]);

  useEffect(() => {
    const ctrl = new AbortController();
    fetch(`/api/forge/projects/${projectId}/summary`, {
      cache: "no-store",
      signal: ctrl.signal,
    })
      .then(async (r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return (await r.json()) as {
          project: ProjectInfo;
          summary: ProjectForgeSummary;
        };
      })
      .then((data) => {
        setProject(data.project);
        setSummary(data.summary);
        setError(null);
      })
      .catch((err) => {
        if (ctrl.signal.aborted) return;
        setError(String(err));
      })
      .finally(() => {
        if (!ctrl.signal.aborted) setLoading(false);
      });
    return () => ctrl.abort();
  }, [projectId]);

  if (loading) {
    return (
      <div className="py-8 text-sm text-muted-foreground">Carregando Forge…</div>
    );
  }

  if (error || !project || !summary) {
    return (
      <div className="py-8 text-sm text-destructive">
        Falha ao carregar Forge: {error ?? "dados ausentes"}
      </div>
    );
  }

  const repoConfigured = Boolean(project.githubRepoOwner && project.githubRepoName);

  return (
    <div className="flex flex-col gap-6 py-2">
      <RepoTargetSection
        project={project}
        configured={repoConfigured}
        onOpenModal={() => setRepoModalOpen(true)}
      />
      <NoBuildersBanner />
      <ActiveBuilders />
      <ForgeProjectCard
        project={project}
        summary={summary}
        onChanged={reload}
      />

      <GitHubRepoModal
        projectId={projectId}
        open={repoModalOpen}
        onOpenChange={setRepoModalOpen}
        current={
          repoConfigured
            ? {
                owner: project.githubRepoOwner!,
                name: project.githubRepoName!,
                branch: project.githubDefaultBranch ?? "main",
              }
            : null
        }
        onSaved={() => {
          setRepoModalOpen(false);
          void reload();
        }}
      />
    </div>
  );
}

function RepoTargetSection({
  project,
  configured,
  onOpenModal,
}: {
  project: ProjectInfo;
  configured: boolean;
  onOpenModal: () => void;
}) {
  if (!configured) {
    return (
      <div className="flex items-start gap-3 rounded-lg border border-dashed border-muted-foreground/30 bg-muted/20 p-4">
        <GitBranch className="size-5 shrink-0 text-muted-foreground mt-0.5" />
        <div className="flex-1">
          <p className="text-sm font-medium">Nenhum repo target configurado</p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            A Forja precisa de um repo GitHub pra clonar, escrever e abrir PR.
          </p>
        </div>
        <Button size="sm" onClick={onOpenModal}>
          <GitBranch className="size-4" />
          Conectar repo
        </Button>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-3 rounded-lg border bg-card p-3">
      <GitBranch className="size-4 shrink-0 text-muted-foreground" />
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium truncate">
          {project.githubRepoOwner}/{project.githubRepoName}
        </p>
        <p className="text-xs text-muted-foreground">
          branch: {project.githubDefaultBranch ?? "main"}
        </p>
      </div>
      <Button size="sm" variant="outline" onClick={onOpenModal}>
        Trocar
      </Button>
    </div>
  );
}
