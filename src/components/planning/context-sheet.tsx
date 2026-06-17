"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  GitBranch,
  RefreshCw,
  Loader2,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import ContextSheetPrimitive from "@/components/agent/context-import/context-sheet";
import {
  TranscriptModal,
  NotionSourceModal,
  SourcePoolModal,
} from "@/components/agent/context-import";
import { GitHubRepoModal } from "@/components/planning/github-repo-modal";
import { createDocumentSource } from "@/lib/context-sources/upload-document";
import { showErrorToast } from "@/lib/optimistic/toast";
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

interface SourceLinkRow {
  linkId: string;
  sourceId: string;
  weight: string | null;
  source: {
    id: string;
    kind: string;
    title: string | null;
    capturedAt: string | null;
  } | null;
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

/** ContextSource.kind → pill kind do ContextSheet (ícone/agrupamento). */
function toPillKind(
  kind: string,
): "transcript" | "spreadsheet" | "github" | "document" | "notion" | "gdrive_file" {
  if (kind === "notion") return "notion";
  if (kind === "gdrive_file") return "gdrive_file";
  if (kind === "spreadsheet_csv" || kind === "spreadsheet_gsheets") return "spreadsheet";
  if (kind === "github_repo" || kind === "github_pr" || kind === "github_issue") return "github";
  if (kind === "transcript" || kind === "meeting") return "transcript";
  return "document";
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
  const [githubModalOpen, setGithubModalOpen] = useState(false);
  const [notionModalOpen, setNotionModalOpen] = useState(false);
  const [poolModalOpen, setPoolModalOpen] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [uploadingFile, setUploadingFile] = useState(false);

  // Insumos linkados via EntityLink.contextSourceId (qualquer kind: documento,
  // notion, gdrive_file, planilha, github). Disjuntos dos transcripts, que vêm
  // por EntityLink.transcriptRefId no prop linkedTranscripts.
  const [sourceLinks, setSourceLinks] = useState<SourceLinkRow[]>([]);

  const refetchSources = useCallback(async () => {
    try {
      const r = await fetch(`/api/planning/${planningId}/context`);
      if (!r.ok) return;
      const json = (await r.json()) as { contextLinks?: SourceLinkRow[] };
      setSourceLinks(json.contextLinks ?? []);
    } catch {
      /* silencioso */
    }
  }, [planningId]);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/planning/${planningId}/context`)
      .then((r) => (r.ok ? r.json() : null))
      .then((json: { contextLinks?: SourceLinkRow[] } | null) => {
        if (cancelled || !json) return;
        setSourceLinks(json.contextLinks ?? []);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [planningId]);

  const sourceLinkIds = useMemo(
    () => new Set(sourceLinks.map((l) => l.linkId)),
    [sourceLinks],
  );
  const linkedSourceIds = useMemo(
    () => sourceLinks.map((l) => l.sourceId),
    [sourceLinks],
  );

  const handleUploadFiles = useCallback(
    async (fileList: FileList) => {
      setUploadingFile(true);
      try {
        for (const file of Array.from(fileList)) {
          const sourceId = await createDocumentSource(projectId, file);
          const r = await fetch(`/api/planning/${planningId}/context/link`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ contextSourceId: sourceId }),
          });
          if (!r.ok) {
            const j = (await r.json().catch(() => ({}))) as { error?: string };
            toast.error(j.error ?? "Falha ao linkar documento");
          }
        }
        await refetchSources();
      } catch (e) {
        showErrorToast(e, { label: "Falha ao enviar documento" });
      } finally {
        setUploadingFile(false);
      }
    },
    [projectId, planningId, refetchSources],
  );

  // Linka um ContextSource já existente no pool do projeto (picker universal).
  const handleLinkFromPool = useCallback(
    async (contextSourceId: string) => {
      const r = await fetch(`/api/planning/${planningId}/context/link`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contextSourceId }),
      });
      if (!r.ok) {
        const j = (await r.json().catch(() => ({}))) as { error?: string };
        throw new Error(j.error ?? "Falha ao linkar fonte");
      }
      await refetchSources();
      onImported();
    },
    [planningId, refetchSources, onImported],
  );

  // Unlink: ContextSource via /context/[linkId]; transcript pelo handler do parent.
  const handleUnlink = useCallback(
    async (itemId: string, title: string) => {
      if (sourceLinkIds.has(itemId)) {
        const r = await fetch(
          `/api/planning/${planningId}/context/${itemId}`,
          { method: "DELETE" },
        );
        if (!r.ok) {
          toast.error("Falha ao remover fonte");
          return;
        }
        await refetchSources();
        return;
      }
      onUnlink(itemId, title);
    },
    [sourceLinkIds, planningId, refetchSources, onUnlink],
  );

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

  // Transcripts (via prop) + fontes do pool (via /context) no mesmo formato.
  const linkedItems = useMemo(
    () => [
      ...linkedTranscripts.map((l) => ({
        id: l.transcriptRefId,
        kind: (l.transcript?.source === "spreadsheet"
          ? "spreadsheet"
          : "transcript") as
          | "transcript"
          | "spreadsheet"
          | "github"
          | "document"
          | "notion"
          | "gdrive_file",
        title: l.transcript?.title ?? null,
        source: l.transcript?.source ?? undefined,
        capturedAt: l.transcript?.capturedAt,
        weight: l.weight,
      })),
      ...sourceLinks.map((l) => ({
        id: l.linkId,
        kind: toPillKind(l.source?.kind ?? "document"),
        title: l.source?.title ?? null,
        source: undefined,
        capturedAt: l.source?.capturedAt,
        weight: l.weight ?? undefined,
      })),
    ],
    [linkedTranscripts, sourceLinks],
  );

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
          pool: true,
          transcript: true,
          file: true,
          notion: true,
          github: true,
        }}
        uploadingFile={uploadingFile}
        handlers={{
          onUnlink: handleUnlink,
          onImportTranscript: () => setTranscriptModalOpen(true),
          onImportGitHub: () => setGithubModalOpen(true),
          onImportNotion: () => setNotionModalOpen(true),
          onUploadFiles: handleUploadFiles,
          onLinkFromPool: () => setPoolModalOpen(true),
        }}
        customGitHubPanel={customGitHubPanel}
      />

      <SourcePoolModal
        open={poolModalOpen}
        onOpenChange={setPoolModalOpen}
        projectId={projectId}
        linkedSourceIds={linkedSourceIds}
        onLink={handleLinkFromPool}
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

      <NotionSourceModal
        apiUrl="/api/context-sources"
        projectId={projectId}
        open={notionModalOpen}
        onOpenChange={setNotionModalOpen}
        onImported={async (contextSourceId) => {
          try {
            await handleLinkFromPool(contextSourceId);
          } catch (e) {
            showErrorToast(e, { label: "Falha ao linkar página do Notion" });
          }
        }}
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
