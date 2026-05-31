"use client";

import { useState, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";
import { Upload, File, X, Loader2, AlertCircle } from "lucide-react";
import {
  ResponsiveSheet,
  ResponsiveSheetContent,
  ResponsiveSheetHeader,
  ResponsiveSheetTitle,
  ResponsiveSheetDescription,
  ResponsiveSheetBody,
  ResponsiveSheetFooter,
} from "@/components/ui/responsive-sheet";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Field, FormBody } from "@/components/ui/field";
import { Badge } from "@/components/ui/badge";
import { parsePrdMarkdown, type ParsedPrd } from "@/lib/sessions/prd-session/parser";
import { showErrorToast } from "@/lib/optimistic/toast";

type UploadedFile = {
  id: string;
  filename: string;
  content: string;
  parsed: ParsedPrd;
};

export function PrdUploadSheet({
  projectId,
  open,
  onOpenChange,
}: {
  projectId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const router = useRouter();
  const [files, setFiles] = useState<UploadedFile[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const [pasteContent, setPasteContent] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const processFiles = useCallback((fileList: FileList) => {
    const mdFiles = Array.from(fileList).filter((f) => f.name.endsWith(".md"));

    if (mdFiles.length === 0) {
      showErrorToast(new Error("Nenhum arquivo .md encontrado"), {
        label: "Upload de PRDs",
      });
      return;
    }

    if (mdFiles.length > 10) {
      showErrorToast(new Error("Máximo de 10 arquivos permitidos"), {
        label: "Upload de PRDs",
      });
      return;
    }

    mdFiles.forEach((file) => {
      const reader = new FileReader();
      reader.onload = (e) => {
        const content = e.target?.result as string;
        const parsed = parsePrdMarkdown(content);
        const newFile: UploadedFile = {
          id: `${Date.now()}-${Math.random()}`,
          filename: file.name,
          content,
          parsed,
        };
        setFiles((cur) => {
          if (cur.length >= 10) return cur;
          return [...cur, newFile];
        });
      };
      reader.readAsText(file);
    });
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setIsDragging(false);
      if (e.dataTransfer.files.length) {
        processFiles(e.dataTransfer.files);
      }
    },
    [processFiles],
  );

  const handlePaste = () => {
    if (!pasteContent.trim()) return;

    const parsed = parsePrdMarkdown(pasteContent);
    const newFile: UploadedFile = {
      id: `${Date.now()}-${Math.random()}`,
      filename: `pasted-${files.length + 1}.md`,
      content: pasteContent,
      parsed,
    };

    if (files.length >= 10) {
      showErrorToast(new Error("Máximo de 10 arquivos permitidos"), {
        label: "Upload de PRDs",
      });
      return;
    }

    setFiles((cur) => [...cur, newFile]);
    setPasteContent("");
  };

  const removeFile = (id: string) => {
    setFiles((cur) => cur.filter((f) => f.id !== id));
  };

  const handleSubmit = async () => {
    if (files.length === 0) return;

    setSubmitting(true);
    try {
      const res = await fetch("/api/sessions/prd/upload", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectId,
          files: files.map((f) => ({
            filename: f.filename,
            content: f.content,
          })),
        }),
      });

      if (!res.ok) {
        const json = await res.json();
        throw new Error(json.error || "Falha ao criar sessão");
      }

      const result = await res.json();
      onOpenChange(false);
      router.push(`/projects/${projectId}/sessions/${result.sessionId}`);
    } catch (error) {
      showErrorToast(error, { label: "Criar PRD Session" });
    } finally {
      setSubmitting(false);
    }
  };

  const formatSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  return (
    <ResponsiveSheet open={open} onOpenChange={onOpenChange}>
      <ResponsiveSheetContent size="lg">
        <ResponsiveSheetHeader>
          <ResponsiveSheetTitle>Upload de PRDs</ResponsiveSheetTitle>
          <ResponsiveSheetDescription>
            Cole markdown ou arraste até 10 arquivos .md. Preview mostra título e warnings em tempo real.
          </ResponsiveSheetDescription>
        </ResponsiveSheetHeader>

        <ResponsiveSheetBody>
          <FormBody density="comfortable">
            {/* Paste area */}
            <Field name="paste-content">
              <Field.Label>Cole markdown aqui</Field.Label>
              <Field.Control>
                <Textarea
                  value={pasteContent}
                  onChange={(e) => setPasteContent(e.target.value)}
                  placeholder="# Título do PRD&#10;&#10;## 1 · Problema&#10;..."
                  rows={6}
                />
              </Field.Control>
              <Field.Hint>
                Pressione o botão abaixo para adicionar o PRD colado à lista
              </Field.Hint>
            </Field>

            <Button
              type="button"
              variant="outline"
              onClick={handlePaste}
              disabled={!pasteContent.trim() || files.length >= 10}
            >
              Adicionar PRD colado
            </Button>

            {/* Drop zone */}
            <div
              onDragOver={(e) => {
                e.preventDefault();
                setIsDragging(true);
              }}
              onDragLeave={() => setIsDragging(false)}
              onDrop={handleDrop}
              onClick={() => inputRef.current?.click()}
              className={`relative flex flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed p-8 cursor-pointer transition-colors ${
                isDragging
                  ? "border-primary bg-primary/5"
                  : "border-muted-foreground/20 hover:border-muted-foreground/40"
              }`}
            >
              <Upload className="h-10 w-10 text-muted-foreground/50" />
              <div className="text-center">
                <p className="text-sm font-medium">Arraste arquivos .md aqui</p>
                <p className="text-xs text-muted-foreground mt-1">
                  Ou clique para selecionar (máximo 10 arquivos)
                </p>
              </div>
              <input
                ref={inputRef}
                type="file"
                multiple
                accept=".md"
                className="hidden"
                onChange={(e) => e.target.files && processFiles(e.target.files)}
              />
            </div>

            {/* File list with preview */}
            {files.length > 0 && (
              <div className="space-y-3">
                <p className="text-sm font-medium">
                  PRDs adicionados ({files.length}/10)
                </p>
                {files.map((f) => (
                  <div
                    key={f.id}
                    className="flex flex-col gap-2 rounded-lg border p-3"
                  >
                    <div className="flex items-start gap-3">
                      <File className="h-4 w-4 text-muted-foreground shrink-0 mt-0.5" />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate">{f.filename}</p>
                        <p className="text-xs text-muted-foreground">
                          {formatSize(f.content.length)} · {f.parsed.acceptanceCriteria.length} critérios
                        </p>
                      </div>
                      <Button
                        variant="ghost"
                        size="icon-xs"
                        onClick={(e) => {
                          e.stopPropagation();
                          removeFile(f.id);
                        }}
                      >
                        <X className="h-3.5 w-3.5" />
                      </Button>
                    </div>

                    {/* Preview */}
                    <div className="pl-7 space-y-1.5">
                      <div className="flex items-baseline gap-2 flex-wrap">
                        <span className="text-xs font-medium text-muted-foreground">
                          Título:
                        </span>
                        <span className="text-xs">{f.parsed.title}</span>
                      </div>

                      {f.parsed.oneLiner && (
                        <div className="flex items-baseline gap-2">
                          <span className="text-xs font-medium text-muted-foreground">
                            One-liner:
                          </span>
                          <span className="text-xs line-clamp-2">
                            {f.parsed.oneLiner}
                          </span>
                        </div>
                      )}

                      {f.parsed.warnings.length > 0 && (
                        <div className="flex items-start gap-1.5 pt-1">
                          <AlertCircle className="h-3 w-3 text-amber-600 dark:text-amber-400 mt-0.5 shrink-0" />
                          <div className="flex flex-wrap gap-1">
                            {f.parsed.warnings.map((w, idx) => (
                              <Badge
                                key={idx}
                                variant="secondary"
                                className="text-[10px] text-amber-600 dark:text-amber-400"
                              >
                                {w}
                              </Badge>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </FormBody>
        </ResponsiveSheetBody>

        <ResponsiveSheetFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={submitting}
          >
            Cancelar
          </Button>
          <Button onClick={handleSubmit} disabled={files.length === 0 || submitting}>
            {submitting && <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />}
            Criar Session ({files.length} PRD{files.length !== 1 ? "s" : ""})
          </Button>
        </ResponsiveSheetFooter>
      </ResponsiveSheetContent>
    </ResponsiveSheet>
  );
}
