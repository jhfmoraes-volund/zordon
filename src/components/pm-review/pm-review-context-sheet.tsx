"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import ContextSheet from "@/components/agent/context-import/context-sheet";
import {
  TranscriptModal,
  GitHubSourceModal,
  SourcePoolModal,
} from "@/components/agent/context-import";
import { ConfirmDialog, type ConfirmState } from "@/components/ui/confirm-dialog";
import { fetchOrThrow, showErrorToast } from "@/lib/optimistic/toast";
import { createDocumentSource } from "@/lib/context-sources/upload-document";

type LinkedTranscript = {
  transcriptRefId: string;
  weight: "primary" | "supporting" | "background" | null;
  transcript: { id: string; source: string | null; title: string | null; capturedAt: string | null } | null;
};

type LinkedMeeting = { meetingId: string; meeting: { id: string; title: string | null; date: string } | null };

// Documentos + GitHub vêm do /context (plural); transcripts chegam por prop.
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

type Props = {
  pmReviewId: string;
  projectId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  linkedTranscripts: LinkedTranscript[];
  linkedMeetings: LinkedMeeting[];
  onChanged: () => void;
};

function kindToPill(
  kind: string,
): "transcript" | "spreadsheet" | "github" | "document" | "notion" | "gdrive_file" {
  if (kind === "document") return "document";
  if (kind === "notion") return "notion";
  if (kind === "gdrive_file") return "gdrive_file";
  if (kind.startsWith("github")) return "github";
  if (kind.startsWith("spreadsheet")) return "spreadsheet";
  return "transcript";
}

export function PMReviewContextSheet({ pmReviewId, projectId, open, onOpenChange, linkedTranscripts, onChanged }: Props) {
  const [importModalOpen, setImportModalOpen] = useState(false);
  const [githubModalOpen, setGithubModalOpen] = useState(false);
  const [poolModalOpen, setPoolModalOpen] = useState(false);
  const [uploadingFile, setUploadingFile] = useState(false);
  const [confirmState, setConfirmState] = useState<ConfirmState | null>(null);

  // Fontes linkadas via /context (qualquer kind: documento, github, gdrive_file,
  // notion, planilha). O endpoint só devolve links com contextSourceId, então
  // transcripts (que vêm por prop) nunca duplicam aqui.
  const [contextLinks, setContextLinks] = useState<ContextLinkRow[]>([]);

  const refetchContext = useCallback(async () => {
    try {
      const r = await fetch(`/api/pm-reviews/${pmReviewId}/context`);
      if (!r.ok) return;
      const json = (await r.json()) as { contextLinks?: ContextLinkRow[] };
      setContextLinks(json.contextLinks ?? []);
    } catch {
      /* silencioso */
    }
  }, [pmReviewId]);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/pm-reviews/${pmReviewId}/context`)
      .then((r) => (r.ok ? r.json() : null))
      .then((json: { contextLinks?: ContextLinkRow[] } | null) => {
        if (cancelled || !json) return;
        setContextLinks(json.contextLinks ?? []);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [pmReviewId]);

  const contextLinkIds = useMemo(
    () => new Set(contextLinks.map((l) => l.linkId)),
    [contextLinks],
  );
  const linkedSourceIds = useMemo(
    () => contextLinks.map((l) => l.sourceId),
    [contextLinks],
  );

  const linkedItems = useMemo(
    () => [
      ...linkedTranscripts.map((l) => ({
        id: l.transcriptRefId,
        kind: "transcript" as const,
        title: l.transcript?.title ?? null,
        source: l.transcript?.source ?? "",
        capturedAt: l.transcript?.capturedAt ?? null,
        weight: l.weight ?? undefined,
      })),
      ...contextLinks.map((l) => ({
        id: l.linkId,
        kind: kindToPill(l.source?.kind ?? "document"),
        title: l.source?.title ?? null,
        source: l.source?.kind ?? undefined,
        capturedAt: l.source?.capturedAt ?? null,
        weight: l.weight ?? undefined,
      })),
    ],
    [linkedTranscripts, contextLinks],
  );

  const linkSource = useCallback(
    async (contextSourceId: string) => {
      const r = await fetch(`/api/pm-reviews/${pmReviewId}/context/link`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contextSourceId }),
      });
      if (!r.ok) {
        const j = (await r.json().catch(() => ({}))) as { error?: string };
        toast.error(j.error ?? "Falha ao linkar fonte");
        return;
      }
      await refetchContext();
      onChanged();
    },
    [pmReviewId, refetchContext, onChanged],
  );

  // Linka um ContextSource já existente no pool do projeto (picker universal —
  // Drive, Notion, planilha, documento, GitHub). Lança em falha pro modal
  // mostrar o erro em vez de marcar "Linkado".
  const handleLinkFromPool = useCallback(
    async (contextSourceId: string) => {
      const r = await fetch(`/api/pm-reviews/${pmReviewId}/context/link`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contextSourceId }),
      });
      if (!r.ok) {
        const j = (await r.json().catch(() => ({}))) as { error?: string };
        throw new Error(j.error ?? "Falha ao linkar fonte");
      }
      await refetchContext();
      onChanged();
    },
    [pmReviewId, refetchContext, onChanged],
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

  function handleUnlink(itemId: string, itemTitle: string) {
    const isContextLink = contextLinkIds.has(itemId);
    setConfirmState({
      title: "Desvincular fonte?",
      description: `"${itemTitle}" será removida deste PM Review.`,
      confirmLabel: "Desvincular",
      destructive: true,
      onConfirm: async () => {
        try {
          if (isContextLink) {
            await fetchOrThrow(`/api/pm-reviews/${pmReviewId}/context/${itemId}`, { method: "DELETE" });
            await refetchContext();
          } else {
            await fetchOrThrow(`/api/pm-review/${pmReviewId}/transcripts/${itemId}`, { method: "DELETE" });
          }
          toast.success("Fonte desvinculada.");
          onChanged();
        } catch (err) {
          showErrorToast(err, { label: "Falha ao desvincular" });
        }
      },
    });
  }

  return (
    <>
      <ContextSheet
        open={open}
        onOpenChange={onOpenChange}
        ritualLabel="PM Review"
        linkedItems={linkedItems}
        capabilities={{
          pool: true,
          transcript: true,
          file: true,
          github: true,
        }}
        uploadingFile={uploadingFile}
        handlers={{
          onUnlink: handleUnlink,
          onImportTranscript: () => setImportModalOpen(true),
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
        apiUrl={`/api/pm-review/${pmReviewId}/transcripts/sources`}
        open={importModalOpen}
        onOpenChange={setImportModalOpen}
        onImported={() => {
          onChanged();
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
