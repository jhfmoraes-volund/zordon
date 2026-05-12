"use client";

import { useCallback, useEffect, useState } from "react";
import { useOptimisticCollection } from "@/hooks/use-optimistic-collection";
import { fetchOrThrow, showErrorToast } from "@/lib/optimistic/toast";

export type SessionFileRow = {
  id: string;
  sessionId: string;
  name: string;
  size: number;
  mimeType: string;
  extractionStatus: "pending" | "success" | "unsupported" | "failed";
  uploadedByMemberId: string | null;
  createdAt: string;
};

function base(sessionId: string) {
  return `/api/design-sessions/${sessionId}/files`;
}

export function useSessionFiles(sessionId: string) {
  const collection = useOptimisticCollection<SessionFileRow>([]);
  const { setCommitted, mutate } = collection;
  const [loaded, setLoaded] = useState(false);
  const [uploading, setUploading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetchOrThrow(base(sessionId));
        const json = (await res.json()) as { files: SessionFileRow[] };
        if (!cancelled) {
          setCommitted(json.files ?? []);
          setLoaded(true);
        }
      } catch {
        if (!cancelled) setLoaded(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [sessionId, setCommitted]);

  const uploadFiles = useCallback(
    async (fileList: FileList): Promise<SessionFileRow[]> => {
      setUploading(true);
      try {
        const formData = new FormData();
        Array.from(fileList).forEach((f) => formData.append("files", f));
        const res = await fetch(`/api/design-sessions/${sessionId}/upload`, {
          method: "POST",
          body: formData,
        });
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          throw new Error(err.error || "Falha ao enviar arquivo");
        }
        const json = (await res.json()) as { files: SessionFileRow[] };
        const uploaded = json.files ?? [];
        setCommitted((prev) => {
          const existingIds = new Set(prev.map((f) => f.id));
          return [...prev, ...uploaded.filter((f) => !existingIds.has(f.id))];
        });
        return uploaded;
      } catch (e) {
        showErrorToast(e, { label: "Falha ao enviar arquivo" });
        return [];
      } finally {
        setUploading(false);
      }
    },
    [sessionId, setCommitted],
  );

  const deleteFile = useCallback(
    async (fileId: string) => {
      await mutate(
        { type: "delete", id: fileId },
        async () => {
          await fetchOrThrow(`${base(sessionId)}/${fileId}`, { method: "DELETE" });
          return true;
        },
        { errorLabel: "Falha ao apagar arquivo", retry: false },
      );
    },
    [sessionId, mutate],
  );

  const getDownloadUrl = useCallback(
    async (fileId: string): Promise<string | null> => {
      try {
        const res = await fetchOrThrow(`${base(sessionId)}/${fileId}/download`);
        const json = (await res.json()) as { url: string };
        return json.url;
      } catch (e) {
        showErrorToast(e, { label: "Falha ao obter link de download" });
        return null;
      }
    },
    [sessionId],
  );

  const getExtractedText = useCallback(
    async (fileId: string): Promise<string | null> => {
      try {
        const res = await fetchOrThrow(`${base(sessionId)}/${fileId}/text`);
        const json = (await res.json()) as { extractedText: string | null };
        return json.extractedText;
      } catch {
        return null;
      }
    },
    [sessionId],
  );

  return {
    files: collection.items,
    loaded,
    uploading,
    uploadFiles,
    deleteFile,
    getDownloadUrl,
    getExtractedText,
  };
}
