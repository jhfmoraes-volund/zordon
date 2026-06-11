"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import {
  BrainCircuit,
  Check,
  ChevronRight,
  ExternalLink,
  File,
  FileText,
  Folder,
  FolderOpen,
  Image as ImageIcon,
  Loader2,
  Presentation,
  RefreshCw,
  Search,
  Table2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { fmtDate } from "@/lib/date-utils";
import { STAGE_LABELS, type DriveStage } from "@/lib/drive/stage";

type DriveFile = {
  id: string;
  fileId: string;
  name: string;
  mimeType: string;
  sizeBytes: number | null;
  modifiedTime: string | null;
  webViewLink: string | null;
  parentId: string | null;
  stage: DriveStage | null;
  syncedAt: string;
};

type FilesPayload = {
  files: DriveFile[];
  syncedAt: string | null;
  folderId: string | null;
  importedFileIds?: string[];
};

const FOLDER_MIME = "application/vnd.google-apps.folder";

const FILE_ICONS = {
  folder: Folder,
  doc: FileText,
  sheet: Table2,
  slides: Presentation,
  image: ImageIcon,
  generic: File,
} as const;

function fileIconKey(mimeType: string): keyof typeof FILE_ICONS {
  if (mimeType === FOLDER_MIME) return "folder";
  if (mimeType === "application/vnd.google-apps.document") return "doc";
  if (mimeType === "application/vnd.google-apps.spreadsheet") return "sheet";
  if (mimeType === "application/vnd.google-apps.presentation") return "slides";
  if (mimeType === "application/pdf") return "doc";
  if (mimeType.startsWith("image/")) return "image";
  return "generic";
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

/** lowercase + sem acento — mesmo critério do folderStage. */
function normalize(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

type Crumb = { id: string; name: string };

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
  const [missingStages, setMissingStages] = useState<DriveStage[]>([]);
  const [connectUrl, setConnectUrl] = useState<string | null>(null);
  const [imported, setImported] = useState<Set<string>>(() => new Set());
  const [importingId, setImportingId] = useState<string | null>(null);
  const [path, setPath] = useState<Crumb[]>([]);
  const [query, setQuery] = useState("");

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/projects/${projectId}/drive/files`);
      if (!res.ok) throw new Error(`GET drive/files ${res.status}`);
      const body = (await res.json()) as FilesPayload;
      setPayload(body);
      setImported(new Set(body.importedFileIds ?? []));
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
        missingStages?: DriveStage[];
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
      setMissingStages(body.missingStages ?? []);
      toast.success("Drive sincronizado");
    } catch {
      toast.error("Sem conexão — sync não concluído");
    } finally {
      setSyncing(false);
    }
  }, [projectId, syncing, driveFolderId]);

  // Import explícito (D5): curadoria humana — nem tudo no Drive vira contexto.
  const importToContext = useCallback(
    async (file: DriveFile) => {
      if (importingId) return;
      setImportingId(file.fileId);
      try {
        const res = await fetch("/api/context-sources", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            kind: "gdrive_file",
            projectId,
            fileId: file.fileId,
          }),
        });
        const body = (await res.json()) as {
          existing?: boolean;
          error?: string;
          connectUrl?: string;
        };
        if (res.status === 412) {
          toast.error(body.error ?? "Conexão Google Drive necessária");
          return;
        }
        if (!res.ok) {
          toast.error(body.error ?? "Falha ao importar pro contexto");
          return;
        }
        setImported((prev) => new Set(prev).add(file.fileId));
        toast.success(
          body.existing
            ? `${file.name} já estava no contexto`
            : `${file.name} importado pro contexto`
        );
      } catch {
        toast.error("Sem conexão — import não concluído");
      } finally {
        setImportingId(null);
      }
    },
    [projectId, importingId]
  );

  const files = useMemo(() => payload?.files ?? [], [payload]);

  const byFileId = useMemo(() => {
    const map = new Map<string, DriveFile>();
    for (const f of files) map.set(f.fileId, f);
    return map;
  }, [files]);

  const childCount = useMemo(() => {
    const map = new Map<string, number>();
    for (const f of files) {
      if (!f.parentId) continue;
      map.set(f.parentId, (map.get(f.parentId) ?? 0) + 1);
    }
    return map;
  }, [files]);

  // Pasta atual pode ter sumido num re-sync — apara o path até um nó válido.
  const validPath = useMemo(() => {
    const valid: Crumb[] = [];
    for (const crumb of path) {
      if (!byFileId.has(crumb.id)) break;
      valid.push(crumb);
    }
    return valid;
  }, [path, byFileId]);

  const currentId = validPath.at(-1)?.id ?? null;

  /** Cadeia raiz→pasta (pra navegar direto a partir da busca). */
  const pathTo = useCallback(
    (folderId: string): Crumb[] => {
      const chain: Crumb[] = [];
      let cursor: DriveFile | undefined = byFileId.get(folderId);
      while (cursor) {
        chain.unshift({ id: cursor.fileId, name: cursor.name });
        cursor = cursor.parentId ? byFileId.get(cursor.parentId) : undefined;
      }
      return chain;
    },
    [byFileId]
  );

  const openFolder = useCallback(
    (f: DriveFile) => {
      setQuery("");
      setPath([...validPath, { id: f.fileId, name: f.name }]);
    },
    [validPath]
  );

  const openSearchResult = useCallback(
    (f: DriveFile) => {
      if (f.mimeType === FOLDER_MIME) {
        setPath(pathTo(f.fileId));
        setQuery("");
      } else if (f.webViewLink) {
        window.open(f.webViewLink, "_blank", "noopener,noreferrer");
      }
    },
    [pathTo]
  );

  const sortedVisible = useMemo(() => {
    const q = normalize(query.trim());
    const pool = q
      ? files.filter((f) => normalize(f.name).includes(q))
      : files.filter((f) => (f.parentId ?? null) === currentId);
    return [...pool].sort((a, b) => {
      const aFolder = a.mimeType === FOLDER_MIME;
      const bFolder = b.mimeType === FOLDER_MIME;
      if (aFolder !== bFolder) return aFolder ? -1 : 1;
      return a.name.localeCompare(b.name, "pt-BR");
    });
  }, [files, query, currentId]);

  const searching = query.trim().length > 0;

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
      <div className="space-y-2">
        {Array.from({ length: 8 }).map((_, i) => (
          <Skeleton key={i} className="h-11 w-full" />
        ))}
      </div>
    );
  }

  const { syncedAt } = payload;
  const currentFolderLink = currentId
    ? (byFileId.get(currentId)?.webViewLink ??
      `https://drive.google.com/drive/folders/${currentId}`)
    : `https://drive.google.com/drive/folders/${driveFolderId}`;

  return (
    <div className="space-y-3">
      {/* Header: busca + status do sync + ações */}
      <div className="flex items-center gap-2">
        <div className="relative flex-1 sm:max-w-xs">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Buscar em todas as pastas..."
            className="h-8 pl-8 text-sm"
          />
        </div>
        <div className="ml-auto flex items-center gap-2">
          {syncedAt && (
            <span className="hidden text-xs text-muted-foreground sm:inline">
              sincronizado {agoLabel(syncedAt)}
            </span>
          )}
          <a
            href={currentFolderLink}
            target="_blank"
            rel="noopener noreferrer"
          >
            <Button variant="outline" size="sm">
              <ExternalLink className="h-4 w-4" />
              <span className="hidden sm:inline">Abrir no Drive</span>
            </Button>
          </a>
          <Button variant="outline" size="sm" onClick={sync} disabled={syncing}>
            <RefreshCw className={cn("h-4 w-4", syncing && "animate-spin")} />
            <span className="hidden sm:inline">
              {syncing ? "Sincronizando..." : "Sincronizar"}
            </span>
          </Button>
        </div>
      </div>

      {/* Breadcrumb (escondido durante busca) */}
      {!searching && (
        <nav className="flex flex-wrap items-center gap-1 text-sm">
          <button
            type="button"
            onClick={() => setPath([])}
            className={cn(
              "flex items-center gap-1.5 rounded px-1.5 py-0.5 hover:bg-muted",
              validPath.length === 0
                ? "font-medium text-foreground"
                : "text-muted-foreground"
            )}
          >
            <FolderOpen className="h-4 w-4" />
            Drive
          </button>
          {validPath.map((crumb, i) => (
            <span key={crumb.id} className="flex items-center gap-1">
              <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
              <button
                type="button"
                onClick={() => setPath(validPath.slice(0, i + 1))}
                className={cn(
                  "max-w-[180px] truncate rounded px-1.5 py-0.5 hover:bg-muted",
                  i === validPath.length - 1
                    ? "font-medium text-foreground"
                    : "text-muted-foreground"
                )}
              >
                {crumb.name}
              </button>
            </span>
          ))}
        </nav>
      )}

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
          Índice parcial (limite de profundidade/volume) — o que faltar, abra
          no Drive.
        </p>
      )}

      {!searching && validPath.length === 0 && missingStages.length > 0 && (
        <p className="text-xs text-muted-foreground">
          Pastas da taxonomia não encontradas no Drive:{" "}
          {missingStages.map((s) => STAGE_LABELS[s]).join(", ")}. Crie-as na
          pasta do projeto pra organizar por etapa.
        </p>
      )}

      {/* Lista navegável (do banco — sem chamada ao Google por clique) */}
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
      ) : sortedVisible.length === 0 ? (
        <div className="surface flex flex-col items-center gap-3 p-10 text-center">
          <p className="text-sm text-muted-foreground">
            {searching
              ? "Nada com esse nome no índice."
              : "Pasta vazia no índice — pode haver conteúdo além da profundidade sincronizada."}
          </p>
          {!searching && (
            <a
              href={currentFolderLink}
              target="_blank"
              rel="noopener noreferrer"
            >
              <Button variant="outline" size="sm">
                <ExternalLink className="h-4 w-4" />
                Abrir no Drive
              </Button>
            </a>
          )}
        </div>
      ) : (
        <div className="surface divide-y divide-border/60 overflow-hidden">
          {sortedVisible.map((f) => (
            <DriveFileRow
              key={f.id}
              file={f}
              subtitle={
                searching
                  ? pathTo(f.fileId)
                      .slice(0, -1)
                      .map((c) => c.name)
                      .join(" / ") || "raiz"
                  : null
              }
              childCount={childCount.get(f.fileId) ?? 0}
              isImported={imported.has(f.fileId)}
              isImporting={importingId === f.fileId}
              onImport={() => importToContext(f)}
              onOpen={() =>
                searching
                  ? openSearchResult(f)
                  : f.mimeType === FOLDER_MIME
                    ? openFolder(f)
                    : f.webViewLink &&
                      window.open(f.webViewLink, "_blank", "noopener,noreferrer")
              }
            />
          ))}
        </div>
      )}
    </div>
  );
}

function DriveFileRow({
  file: f,
  subtitle,
  childCount,
  isImported,
  isImporting,
  onImport,
  onOpen,
}: {
  file: DriveFile;
  subtitle: string | null;
  childCount: number;
  isImported: boolean;
  isImporting: boolean;
  onImport: () => void;
  onOpen: () => void;
}) {
  const Icon = FILE_ICONS[fileIconKey(f.mimeType)];
  const isFolder = f.mimeType === FOLDER_MIME;
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onOpen();
        }
      }}
      className="group flex w-full cursor-pointer items-center gap-3 px-3 py-2.5 text-left transition-colors hover:bg-muted/60"
    >
      <Icon
        className={cn(
          "h-5 w-5 shrink-0",
          isFolder ? "text-blue-400" : "text-muted-foreground"
        )}
      />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">{f.name}</p>
        {subtitle && (
          <p className="truncate text-xs text-muted-foreground">{subtitle}</p>
        )}
      </div>
      {isImported && (
        <span className="inline-flex shrink-0 items-center gap-0.5 rounded bg-emerald-500/10 px-1 py-0.5 text-[10px] font-medium text-emerald-600 dark:text-emerald-400">
          <Check className="h-2.5 w-2.5" /> no contexto
        </span>
      )}
      <span className="hidden w-24 shrink-0 text-right text-xs text-muted-foreground sm:inline">
        {isFolder
          ? `${childCount} ${childCount === 1 ? "item" : "itens"}`
          : f.modifiedTime
            ? fmtDate(f.modifiedTime)
            : "—"}
      </span>
      <div className="flex shrink-0 items-center gap-1">
        {!isFolder && !isImported && (
          <button
            type="button"
            title="Importar pro contexto"
            disabled={isImporting}
            onClick={(e) => {
              e.stopPropagation();
              onImport();
            }}
            className="rounded p-1 text-muted-foreground opacity-0 transition-opacity hover:bg-muted hover:text-foreground group-hover:opacity-100 disabled:opacity-100"
          >
            {isImporting ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <BrainCircuit className="h-3.5 w-3.5" />
            )}
          </button>
        )}
        <a
          href={f.webViewLink ?? "#"}
          target="_blank"
          rel="noopener noreferrer"
          title="Abrir no Drive"
          onClick={(e) => e.stopPropagation()}
          className="rounded p-1 text-muted-foreground opacity-0 transition-opacity hover:bg-muted hover:text-foreground group-hover:opacity-100"
        >
          <ExternalLink className="h-3.5 w-3.5" />
        </a>
      </div>
    </div>
  );
}
