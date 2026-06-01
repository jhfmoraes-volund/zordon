"use client";

import { useState } from "react";
import {
  GitBranch,
  RefreshCw,
  Loader2,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import ContextSheetPrimitive from "@/components/agent/context-import/context-sheet";
import { TranscriptModal } from "@/components/agent/context-import";
import { SpreadsheetImportModal } from "@/components/planning/spreadsheet-import-modal";
import { GitHubRepoModal } from "@/components/planning/github-repo-modal";
import { fmtDate } from "@/lib/date-utils";

interface LinkedTranscript {
  transcriptRefId: string;
  transcript: {
    id: string;
    title: string | null;
    source: string | null;
    capturedAt: string | null;
  } | null;
  weight: string;
}

interface ProjectRepo {
  owner: string | null;
  name: string | null;
  branch: string | null;
  manifestUpdatedAt: string | null;
}

interface PlanningContextSheetProps {
  planningId: string;
  projectId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  linkedTranscripts: LinkedTranscript[];
  projectRepo: ProjectRepo | null;
  onUnlink: (transcriptRefId: string, title: string) => void;
  onImported: () => void;
}

export function ContextSheet({
  planningId,
  projectId,
  open,
  onOpenChange,
  linkedTranscripts,
  projectRepo,
  onUnlink,
  onImported,
}: PlanningContextSheetProps) {
  const [transcriptModalOpen, setTranscriptModalOpen] = useState(false);
  const [spreadsheetModalOpen, setSpreadsheetModalOpen] = useState(false);
  const [githubModalOpen, setGithubModalOpen] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const repoConfigured = Boolean(
    projectRepo && projectRepo.owner && projectRepo.name,
  );

  const handleRefreshManifest = async () => {
    setRefreshing(true);
    try {
      const r = await fetch(`/api/projects/${projectId}/repo/refresh-manifest`, {
        method: "POST",
      });
      const data = (await r.json()) as {
        manifest?: { sizeBytes: number };
        error?: string;
      };
      if (!r.ok) {
        toast.error(data.error ?? "Falha ao atualizar manifest");
        return;
      }
      if (data.manifest) {
        const kb = Math.round(data.manifest.sizeBytes / 1024);
        toast.success(`Manifest atualizado · ${kb}KB`);
      }
      onImported();
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setRefreshing(false);
    }
  };

  const handleUnlinkRepo = async () => {
    setRefreshing(true);
    try {
      const r = await fetch(`/api/projects/${projectId}/repo`, {
        method: "DELETE",
      });
      if (!r.ok) {
        const data = (await r.json().catch(() => ({}))) as { error?: string };
        toast.error(data.error ?? "Falha ao desvincular repo");
        return;
      }
      toast.success("Repo desvinculado");
      onImported();
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setRefreshing(false);
    }
  };

  // Map linked transcripts to ContextSheet format
  const linkedItems = linkedTranscripts.map((l) => ({
    id: l.transcriptRefId,
    kind: (l.transcript?.source === "spreadsheet" ? "spreadsheet" : "transcript") as "transcript" | "spreadsheet" | "github",
    title: l.transcript?.title ?? null,
    source: l.transcript?.source ?? undefined,
    capturedAt: l.transcript?.capturedAt,
    weight: l.weight,
  }));

  // Custom GitHub panel with refresh + unlink controls
  const customGitHubPanel = repoConfigured ? (
    <>
      <div className="flex items-center gap-2">
        <GitBranch className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-mono truncate">
            {projectRepo!.owner}/{projectRepo!.name}
          </p>
          <p className="text-xs text-muted-foreground">
            branch <code>{projectRepo!.branch ?? "main"}</code>
            {projectRepo!.manifestUpdatedAt ? (
              <> · manifest {fmtDate(projectRepo!.manifestUpdatedAt)}</>
            ) : (
              <> · sem manifest</>
            )}
          </p>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Button
          variant="outline"
          size="sm"
          disabled={refreshing}
          onClick={handleRefreshManifest}
        >
          {refreshing ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <RefreshCw className="h-3.5 w-3.5" />
          )}
          Atualizar manifest
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setGithubModalOpen(true)}
          disabled={refreshing}
        >
          Trocar repo
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="text-muted-foreground hover:text-destructive"
          onClick={handleUnlinkRepo}
          disabled={refreshing}
        >
          Desvincular
        </Button>
      </div>
    </>
  ) : null;

  return (
    <>
      <ContextSheetPrimitive
        open={open}
        onOpenChange={onOpenChange}
        ritualLabel="Planning"
        linkedItems={linkedItems}
        capabilities={{
          transcript: true,
          spreadsheet: true,
          github: true,
        }}
        handlers={{
          onUnlink,
          onImportTranscript: () => setTranscriptModalOpen(true),
          onImportSpreadsheet: () => setSpreadsheetModalOpen(true),
          onImportGitHub: () => setGithubModalOpen(true),
        }}
        customGitHubPanel={customGitHubPanel}
      />

      <TranscriptModal
        apiUrl={`/api/planning/${planningId}/transcripts/sources`}
        open={transcriptModalOpen}
        onOpenChange={setTranscriptModalOpen}
        subtitle="Vitória vai usar a transcrição como contexto da planning."
        onImported={() => {
          setTranscriptModalOpen(false);
          onImported();
        }}
      />

      <SpreadsheetImportModal
        planningId={planningId}
        open={spreadsheetModalOpen}
        onOpenChange={setSpreadsheetModalOpen}
        onImported={onImported}
      />

      <GitHubRepoModal
        projectId={projectId}
        open={githubModalOpen}
        onOpenChange={setGithubModalOpen}
        current={
          projectRepo?.owner && projectRepo?.name
            ? {
                owner: projectRepo.owner,
                name: projectRepo.name,
                branch: projectRepo.branch ?? "main",
              }
            : null
        }
        onSaved={onImported}
      />
    </>
  );
}
