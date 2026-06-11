"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import ContextSheet from "@/components/agent/context-import/context-sheet";
import {
  TranscriptModal,
  GitHubSourceModal,
  NotionSourceModal,
} from "@/components/agent/context-import";
import {
  ConfirmDialog,
  type ConfirmState,
} from "@/components/ui/confirm-dialog";
import { createDocumentSource } from "@/lib/context-sources/upload-document";
import { showErrorToast } from "@/lib/optimistic/toast";

/**
 * Painel único de Insumos para Design Sessions (Inception + PRD).
 *
 * Dono do sheet completo: transcript + documento + github, todos sobre o mesmo
 * modelo `ContextSource` + `EntityLink.contextSourceId`. Cada superfície DS só
 * renderiza este componente e abre/fecha via `open`/`onOpenChange`.
 *
 * Fluxo de import:
 *   • transcript → POST /transcripts (cria ContextSource kind='transcript' + linka)
 *   • documento → POST /api/context-sources (kind='document') → POST /context/link
 *   • github → POST /api/context-sources → POST /context/link
 * Unlink (qualquer kind) → DELETE /context/[linkId] (linkId = EntityLink.id).
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
): "transcript" | "spreadsheet" | "github" | "document" | "notion" {
  if (kind === "document") return "document";
  if (kind === "notion") return "notion";
  if (kind.startsWith("spreadsheet")) return "spreadsheet";
  if (kind.startsWith("github")) return "github";
  return "transcript";
}

interface Props {
  sessionId: string;
  projectId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  ritualLabel?: string;
  /** Bump pra refetch externo (ex.: import feito pelo composer da step). */
  refreshKey?: number;
  /** Disparado após qualquer mudança (link/unlink/import). */
  onChanged?: () => void;
  /** Recebe o total de insumos linkados — pro contador do botão na ribbon. */
  onCountChange?: (count: number) => void;
}

export function DesignSessionContextSheet({
  sessionId,
  projectId,
  open,
  onOpenChange,
  ritualLabel = "DS",
  refreshKey = 0,
  onChanged,
  onCountChange,
}: Props) {
  const [links, setLinks] = useState<ContextLinkRow[]>([]);
  const [transcriptModalOpen, setTranscriptModalOpen] = useState(false);
  const [githubModalOpen, setGithubModalOpen] = useState(false);
  const [notionModalOpen, setNotionModalOpen] = useState(false);
  const [uploadingFile, setUploadingFile] = useState(false);
  const [confirmState, setConfirmState] = useState<ConfirmState | null>(null);

  const applyRows = useCallback((rows: ContextLinkRow[]) => {
    setLinks(rows);
  }, []);

  useEffect(() => {
    onCountChange?.(links.length);
  }, [links.length, onCountChange]);

  const refetch = useCallback(async () => {
    try {
      const r = await fetch(`/api/design-sessions/${sessionId}/context`);
      if (!r.ok) return;
      const json = (await r.json()) as { contextLinks?: ContextLinkRow[] };
      applyRows(json.contextLinks ?? []);
    } catch {
      /* silencioso — sheet só não popula */
    }
  }, [sessionId, applyRows]);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/design-sessions/${sessionId}/context`)
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

  // Linka um ContextSource recém-criado (documento/github) a esta sessão.
  const linkSource = useCallback(
    async (contextSourceId: string) => {
      const r = await fetch(`/api/design-sessions/${sessionId}/context/link`, {
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

  const handleUnlink = useCallback(
    (linkId: string, title: string) => {
      setConfirmState({
        title: "Desvincular insumo?",
        description: `"${title}" será removido desta sessão.`,
        confirmLabel: "Desvincular",
        destructive: true,
        onConfirm: async () => {
          const r = await fetch(
            `/api/design-sessions/${sessionId}/context/${linkId}`,
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
        ritualLabel={ritualLabel}
        linkedItems={linkedItems}
        capabilities={{
          transcript: true,
          file: true,
          github: true,
          notion: true,
        }}
        uploadingFile={uploadingFile}
        handlers={{
          onUnlink: handleUnlink,
          onImportTranscript: () => setTranscriptModalOpen(true),
          onImportGitHub: () => setGithubModalOpen(true),
          onImportNotion: () => setNotionModalOpen(true),
          onUploadFiles: handleUploadFiles,
        }}
      />

      <TranscriptModal
        apiUrl={`/api/design-sessions/${sessionId}/transcripts`}
        open={transcriptModalOpen}
        onOpenChange={setTranscriptModalOpen}
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

      <NotionSourceModal
        apiUrl="/api/context-sources"
        projectId={projectId}
        open={notionModalOpen}
        onOpenChange={setNotionModalOpen}
        onImported={(id) => {
          void linkSource(id);
        }}
      />

      <ConfirmDialog
        state={confirmState}
        onClose={() => setConfirmState(null)}
      />
    </>
  );
}
