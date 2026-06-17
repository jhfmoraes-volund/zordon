"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import ContextSheet from "@/components/agent/context-import/context-sheet";
import {
  TranscriptModal,
  GitHubSourceModal,
  SourcePoolModal,
} from "@/components/agent/context-import";
import {
  ConfirmDialog,
  type ConfirmState,
} from "@/components/ui/confirm-dialog";
import { createDocumentSource } from "@/lib/context-sources/upload-document";
import { showErrorToast } from "@/lib/optimistic/toast";

/**
 * Painel único de Insumos do Release Planning. Espelha o
 * DesignSessionContextSheet — mesmo modelo ContextSource + EntityLink.
 *
 * Import:
 *   • transcript → POST /api/planning-sessions/[id]/transcripts (cria + linka)
 *   • planilha/github → POST /api/context-sources (cria) → POST .../context/link (linka)
 * Unlink → DELETE .../context/[linkId].
 */

type ContextLinkRow = {
  linkId: string;
  sourceId: string;
  weight: string | null;
  source: {
    id: string;
    kind: string;
    title: string | null;
    externalUrl: string | null;
    capturedAt: string | null;
    summary: string | null;
  } | null;
};

function kindToPill(
  kind: string,
): "transcript" | "spreadsheet" | "github" | "document" | "notion" | "gdrive_file" {
  if (kind === "document") return "document";
  if (kind === "notion") return "notion";
  if (kind === "gdrive_file") return "gdrive_file";
  if (kind.startsWith("spreadsheet")) return "spreadsheet";
  if (kind.startsWith("github")) return "github";
  return "transcript";
}

interface Props {
  sessionId: string;
  projectId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  refreshKey?: number;
  onChanged?: () => void;
  onCountChange?: (count: number) => void;
}

export function ReleasePlanningContextSheet({
  sessionId,
  projectId,
  open,
  onOpenChange,
  refreshKey = 0,
  onChanged,
  onCountChange,
}: Props) {
  const [links, setLinks] = useState<ContextLinkRow[]>([]);
  const [transcriptModalOpen, setTranscriptModalOpen] = useState(false);
  const [githubModalOpen, setGithubModalOpen] = useState(false);
  const [poolModalOpen, setPoolModalOpen] = useState(false);
  const [uploadingFile, setUploadingFile] = useState(false);
  const [confirmState, setConfirmState] = useState<ConfirmState | null>(null);

  const linkedSourceIds = useMemo(() => links.map((l) => l.sourceId), [links]);

  const applyRows = useCallback(
    (rows: ContextLinkRow[]) => {
      setLinks(rows);
      onCountChange?.(rows.length);
    },
    [onCountChange],
  );

  const refetch = useCallback(async () => {
    try {
      const r = await fetch(`/api/planning-sessions/${sessionId}/context`);
      if (!r.ok) return;
      const json = (await r.json()) as { contextLinks?: ContextLinkRow[] };
      applyRows(json.contextLinks ?? []);
    } catch {
      /* silencioso */
    }
  }, [sessionId, applyRows]);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/planning-sessions/${sessionId}/context`)
      .then((r) => (r.ok ? r.json() : null))
      .then((json: { contextLinks?: ContextLinkRow[] } | null) => {
        if (cancelled || !json) return;
        applyRows(json.contextLinks ?? []);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [sessionId, refreshKey, applyRows]);

  const linkedItems = useMemo(
    () =>
      links.map((l) => ({
        id: l.linkId,
        kind: kindToPill(l.source?.kind ?? "transcript"),
        title: l.source?.title ?? null,
        source: l.source?.kind ?? undefined,
        capturedAt: l.source?.capturedAt ?? null,
        weight: l.weight ?? undefined,
      })),
    [links],
  );

  const linkSource = useCallback(
    async (contextSourceId: string) => {
      const r = await fetch(`/api/planning-sessions/${sessionId}/context/link`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contextSourceId }),
      });
      if (!r.ok) {
        const j = (await r.json().catch(() => ({}))) as { error?: string };
        toast.error(j.error ?? "Falha ao linkar fonte");
        return;
      }
      await refetch();
      onChanged?.();
    },
    [sessionId, refetch, onChanged],
  );

  // Linka um ContextSource já no pool do projeto (picker universal — Drive,
  // Notion, planilha, documento, GitHub). Lança em falha pro modal mostrar erro.
  const handleLinkFromPool = useCallback(
    async (contextSourceId: string) => {
      const r = await fetch(`/api/planning-sessions/${sessionId}/context/link`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contextSourceId }),
      });
      if (!r.ok) {
        const j = (await r.json().catch(() => ({}))) as { error?: string };
        throw new Error(j.error ?? "Falha ao linkar fonte");
      }
      await refetch();
      onChanged?.();
    },
    [sessionId, refetch, onChanged],
  );

  const handleUnlink = useCallback(
    (linkId: string, title: string) => {
      setConfirmState({
        title: "Desvincular insumo?",
        description: `"${title}" será removido deste release planning.`,
        confirmLabel: "Desvincular",
        destructive: true,
        onConfirm: async () => {
          const r = await fetch(
            `/api/planning-sessions/${sessionId}/context/${linkId}`,
            { method: "DELETE" },
          );
          if (!r.ok) {
            toast.error("Falha ao desvincular");
            return;
          }
          await refetch();
          onChanged?.();
        },
      });
    },
    [sessionId, refetch, onChanged],
  );

  const handleUploadFiles = useCallback(
    async (fileList: FileList) => {
      setUploadingFile(true);
      try {
        for (const file of Array.from(fileList)) {
          const sourceId = await createDocumentSource(projectId, file);
          await linkSource(sourceId);
        }
      } catch (e) {
        showErrorToast(e, { label: "Falha ao enviar documento" });
      } finally {
        setUploadingFile(false);
      }
    },
    [projectId, linkSource],
  );

  return (
    <>
      <ContextSheet
        open={open}
        onOpenChange={onOpenChange}
        ritualLabel="Release Planning"
        linkedItems={linkedItems}
        capabilities={{ pool: true, transcript: true, file: true, github: true }}
        uploadingFile={uploadingFile}
        handlers={{
          onUnlink: handleUnlink,
          onImportTranscript: () => setTranscriptModalOpen(true),
          onImportGitHub: () => setGithubModalOpen(true),
          onUploadFiles: handleUploadFiles,
          onLinkFromPool: () => setPoolModalOpen(true),
        }}
      />

      <SourcePoolModal
        open={poolModalOpen}
        onOpenChange={setPoolModalOpen}
        projectId={projectId}
        linkedSourceIds={linkedSourceIds}
        onLink={handleLinkFromPool}
      />

      <TranscriptModal
        apiUrl={`/api/planning-sessions/${sessionId}/transcripts`}
        open={transcriptModalOpen}
        onOpenChange={setTranscriptModalOpen}
        subtitle="Vitória vai usar a transcrição como contexto do release planning."
        onImported={() => {
          void refetch();
          onChanged?.();
        }}
      />

      <GitHubSourceModal
        apiUrl="/api/context-sources"
        projectId={projectId}
        open={githubModalOpen}
        onOpenChange={setGithubModalOpen}
        onImported={(id) => {
          void linkSource(id);
        }}
      />

      <ConfirmDialog state={confirmState} onClose={() => setConfirmState(null)} />
    </>
  );
}
