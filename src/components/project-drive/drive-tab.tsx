"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import {
  ExternalLink,
  File,
  FileText,
  Folder,
  FolderOpen,
  Image as ImageIcon,
  Presentation,
  RefreshCw,
  Table2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { fmtDate } from "@/lib/date-utils";

type DriveFile = {
  id: string;
  fileId: string;
  name: string;
  mimeType: string;
  sizeBytes: number | null;
  modifiedTime: string | null;
  webViewLink: string | null;
  syncedAt: string;
};

type FilesPayload = {
  files: DriveFile[];
  syncedAt: string | null;
  folderId: string | null;
};

const FOLDER_MIME = "application/vnd.google-apps.folder";

function fileIcon(mimeType: string): typeof File {
  if (mimeType === FOLDER_MIME) return Folder;
  if (mimeType === "application/vnd.google-apps.document") return FileText;
  if (mimeType === "application/vnd.google-apps.spreadsheet") return Table2;
  if (mimeType === "application/vnd.google-apps.presentation") return Presentation;
  if (mimeType === "application/pdf") return FileText;
  if (mimeType.startsWith("image/")) return ImageIcon;
  return File;
}

function agoLabel(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const min = Math.floor(ms / 60000);
  if (min < 1) return "agora";
  if (min < 60) return `há ${min}min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `há ${h}h`;
  const d = Math.floor(h / 24);
  return `há ${d}d`;
}

export function ProjectDriveTab({
  projectId,
  driveFolderId,
  onConfigureFolder,
}: {
  projectId: string;
  driveFolderId: string | null;
  onConfigureFolder: () => void;
}) {
  const [payload, setPayload] = useState<FilesPayload | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [truncated, setTruncated] = useState(false);
  const [connectUrl, setConnectUrl] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/projects/${projectId}/drive/files`);
      if (!res.ok) throw new Error(`GET drive/files ${res.status}`);
      setPayload((await res.json()) as FilesPayload);
    } catch {
      toast.error("Erro ao carregar arquivos do Drive");
      setPayload({ files: [], syncedAt: null, folderId: driveFolderId });
    }
  }, [projectId, driveFolderId]);

  useEffect(() => {
    load();
  }, [load]);

  const sync = useCallback(async () => {
    if (syncing) return;
    setSyncing(true);
    setConnectUrl(null);
    try {
      const res = await fetch(`/api/projects/${projectId}/drive/sync`, {
        method: "POST",
      });
      const body = (await res.json()) as {
        files?: DriveFile[];
        syncedAt?: string;
        truncated?: boolean;
        error?: string;
        connectUrl?: string;
      };
      if (res.status === 412) {
        setConnectUrl(body.connectUrl ?? "/settings");
        toast.error(body.error ?? "Conexão Google Drive necessária");
        return;
      }
      if (res.status === 409) {
        toast.error("Configure a pasta do Drive no Editar projeto");
        return;
      }
      if (!res.ok) {
        toast.error(body.error ?? "Falha ao sincronizar com o Drive");
        return;
      }
      setPayload({
        files: body.files ?? [],
        syncedAt: body.syncedAt ?? null,
        folderId: driveFolderId,
      });
      setTruncated(Boolean(body.truncated));
      toast.success("Drive sincronizado");
    } catch {
      toast.error("Sem conexão — sync não concluído");
    } finally {
      setSyncing(false);
    }
  }, [projectId, syncing, driveFolderId]);

  // ── Estado: sem pasta configurada ─────────────────────────
  if (!driveFolderId) {
    return (
      <div className="surface flex flex-col items-center gap-3 p-10 text-center">
        <FolderOpen className="h-8 w-8 text-muted-foreground" />
        <p className="text-sm text-muted-foreground">
          Nenhuma pasta do Google Drive vinculada a este projeto.
        </p>
        <Button variant="outline" size="sm" onClick={onConfigureFolder}>
          Configurar pasta do Drive
        </Button>
      </div>
    );
  }

  if (!payload) {
    return (
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 8 }).map((_, i) => (
          <Skeleton key={i} className="h-20 w-full" />
        ))}
      </div>
    );
  }

  const { files, syncedAt } = payload;

  return (
    <div className="space-y-3">
      {/* Header: status do sync + ações */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <FolderOpen className="h-4 w-4" />
          <a
            href={`https://drive.google.com/drive/folders/${driveFolderId}`}
            target="_blank"
            rel="noopener noreferrer"
            className="hover:underline"
          >
            Pasta do projeto
          </a>
          {syncedAt && <span>· sincronizado {agoLabel(syncedAt)}</span>}
        </div>
        <Button variant="outline" size="sm" onClick={sync} disabled={syncing}>
          <RefreshCw className={cn("h-4 w-4", syncing && "animate-spin")} />
          <span className="hidden sm:inline">
            {syncing ? "Sincronizando..." : "Sincronizar"}
          </span>
        </Button>
      </div>

      {connectUrl && (
        <div className="surface flex items-center justify-between gap-3 border-amber-500/40 p-3">
          <p className="text-sm text-muted-foreground">
            O dono do sync precisa conectar o Google Drive nas integrações.
          </p>
          <a href={connectUrl}>
            <Button variant="outline" size="sm">
              Conectar Google Drive
            </Button>
          </a>
        </div>
      )}

      {truncated && (
        <p className="text-xs text-amber-600 dark:text-amber-400">
          Mostrando os primeiros 200 itens — abra a pasta no Drive pra ver tudo.
        </p>
      )}

      {/* Grid de arquivos (do índice — sem chamada ao Google) */}
      {files.length === 0 ? (
        <div className="surface flex flex-col items-center gap-3 p-10 text-center">
          <p className="text-sm text-muted-foreground">
            Pasta vazia ou ainda não sincronizada.
          </p>
          <Button variant="outline" size="sm" onClick={sync} disabled={syncing}>
            <RefreshCw className={cn("h-4 w-4", syncing && "animate-spin")} />
            Sincronizar agora
          </Button>
        </div>
      ) : (
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          {files.map((f) => {
            const Icon = fileIcon(f.mimeType);
            const isFolder = f.mimeType === FOLDER_MIME;
            return (
              <a
                key={f.id}
                href={f.webViewLink ?? "#"}
                target="_blank"
                rel="noopener noreferrer"
                className="group surface flex items-start gap-3 p-3 transition-colors hover:bg-muted/60"
              >
                <Icon
                  className={cn(
                    "mt-0.5 h-5 w-5 shrink-0",
                    isFolder ? "text-blue-400" : "text-muted-foreground"
                  )}
                />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{f.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {isFolder
                      ? "pasta"
                      : f.modifiedTime
                        ? fmtDate(f.modifiedTime)
                        : "—"}
                  </p>
                </div>
                <ExternalLink className="h-3.5 w-3.5 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
              </a>
            );
          })}
        </div>
      )}
    </div>
  );
}
