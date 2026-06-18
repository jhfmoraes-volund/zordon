"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  Upload,
  FileCode2,
  Download,
  Trash2,
  Loader2,
  RefreshCw,
} from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { showErrorToast } from "@/lib/optimistic/toast";
import { fmtDate } from "@/lib/date-utils";

type DesignSystemDoc = {
  id: string;
  title: string;
  mimeType: string | null;
  size: number | null;
  updatedAt: string;
  downloadUrl: string | null;
};

const ACCEPT = ".html,.htm,.pdf,.css,.md,.txt,.json";

function formatSize(bytes: number | null): string {
  if (bytes == null) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

type ConfirmState = React.ComponentProps<typeof ConfirmDialog>["state"];

export function DesignSystemUpload({ projectId }: { projectId: string }) {
  const [doc, setDoc] = useState<DesignSystemDoc | null>(null);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [confirm, setConfirm] = useState<ConfirmState>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const res = await fetch(`/api/projects/${projectId}/design-system`);
        if (!res.ok) throw new Error("Falha ao carregar");
        const json = await res.json();
        if (active) setDoc(json.designSystem ?? null);
      } catch (e) {
        if (active) showErrorToast(e as Error, { label: "Design System" });
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [projectId]);

  const upload = useCallback(
    async (file: File) => {
      setUploading(true);
      try {
        const body = new FormData();
        body.append("file", file);
        const res = await fetch(`/api/projects/${projectId}/design-system`, {
          method: "PUT",
          body,
        });
        if (!res.ok) {
          const json = await res.json().catch(() => ({}));
          throw new Error(json.error ?? "Falha no upload");
        }
        const json = await res.json();
        setDoc(json.designSystem ?? null);
      } catch (e) {
        showErrorToast(e as Error, { label: "Upload do design system" });
      } finally {
        setUploading(false);
        if (inputRef.current) inputRef.current.value = "";
      }
    },
    [projectId],
  );

  function handleRemove() {
    setConfirm({
      title: "Remover design system?",
      description: `“${doc?.title}” deixará de alimentar os agentes deste projeto.`,
      confirmLabel: "Remover",
      destructive: true,
      onConfirm: async () => {
        try {
          const res = await fetch(`/api/projects/${projectId}/design-system`, {
            method: "DELETE",
          });
          if (!res.ok) throw new Error("Falha ao remover");
          setDoc(null);
        } catch (e) {
          showErrorToast(e as Error, { label: "Remover design system" });
        }
      },
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Design System</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-xs text-muted-foreground">
          Anexe o design system do projeto (HTML com tokens e componentes). Os
          agentes leem o conteúdo cru via contexto pra gerar UI no mesmo padrão.
          Um arquivo por projeto — enviar de novo substitui o atual.
        </p>

        {loading ? (
          <div className="flex h-20 items-center justify-center rounded-lg border border-dashed">
            <Loader2 className="size-4 animate-spin text-muted-foreground" />
          </div>
        ) : doc ? (
          // ── Estado: enviado ──
          <div className="flex items-center gap-3 rounded-lg border bg-muted/30 px-3 py-2.5">
            <div className="grid size-9 shrink-0 place-items-center rounded-md border bg-background">
              <FileCode2 className="size-4 text-muted-foreground" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">{doc.title}</p>
              <p className="text-xs text-muted-foreground">
                {[formatSize(doc.size), `enviado ${fmtDate(doc.updatedAt)}`]
                  .filter(Boolean)
                  .join(" · ")}
              </p>
            </div>
            {doc.downloadUrl ? (
              <a
                href={doc.downloadUrl}
                target="_blank"
                rel="noreferrer"
                title="Baixar"
                className={buttonVariants({
                  variant: "ghost",
                  size: "icon",
                  className: "size-8",
                })}
              >
                <Download className="size-3.5" />
              </a>
            ) : null}
            <Button
              variant="ghost"
              size="icon"
              className="size-8"
              disabled={uploading}
              onClick={() => inputRef.current?.click()}
              title="Substituir"
            >
              {uploading ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <RefreshCw className="size-3.5" />
              )}
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="size-8 text-destructive hover:text-destructive"
              disabled={uploading}
              onClick={handleRemove}
              title="Remover"
            >
              <Trash2 className="size-3.5" />
            </Button>
          </div>
        ) : (
          // ── Estado: vazio (dropzone) ──
          <div
            onDragOver={(e) => {
              e.preventDefault();
              setIsDragging(true);
            }}
            onDragLeave={() => setIsDragging(false)}
            onDrop={(e) => {
              e.preventDefault();
              setIsDragging(false);
              if (e.dataTransfer.files[0]) upload(e.dataTransfer.files[0]);
            }}
            onClick={() => !uploading && inputRef.current?.click()}
            className={`flex h-24 cursor-pointer flex-col items-center justify-center gap-1.5 rounded-lg border-2 border-dashed transition-colors ${
              isDragging
                ? "border-primary bg-primary/5"
                : "border-muted-foreground/20 hover:border-muted-foreground/40"
            }`}
          >
            {uploading ? (
              <Loader2 className="size-6 animate-spin text-muted-foreground" />
            ) : (
              <Upload className="size-6 text-muted-foreground/50" />
            )}
            <p className="text-sm">
              {uploading ? (
                "Enviando…"
              ) : (
                <>
                  Arraste ou{" "}
                  <span className="font-medium text-primary">
                    clique para enviar
                  </span>
                </>
              )}
            </p>
            <p className="text-xs text-muted-foreground">
              HTML, PDF, MD · até 25 MB
            </p>
          </div>
        )}

        <input
          ref={inputRef}
          type="file"
          accept={ACCEPT}
          className="hidden"
          onChange={(e) => {
            if (e.target.files?.[0]) upload(e.target.files[0]);
          }}
        />
      </CardContent>

      <ConfirmDialog state={confirm} onClose={() => setConfirm(null)} />
    </Card>
  );
}
