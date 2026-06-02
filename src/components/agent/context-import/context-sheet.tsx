"use client";

import { useRef, useState } from "react";
import {
  File,
  FileSpreadsheet,
  FileText,
  GitBranch,
  Loader2,
  Unlink,
} from "lucide-react";
import {
  ResponsiveSheet,
  ResponsiveSheetContent,
  ResponsiveSheetHeader,
  ResponsiveSheetFooter,
} from "@/components/ui/responsive-sheet";
import { SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

type PillKind = "transcript" | "spreadsheet" | "github" | "document";

/** Formatos aceitos no upload de documentos — espelha o backend de extração. */
const FILE_ACCEPT = ".pdf,.docx,.txt,.md,.html,.htm,.csv,.xlsx,.xls";

interface ContextItem {
  id: string;
  kind: PillKind;
  title: string | null;
  source?: string;
  capturedAt?: string | null;
  weight?: string;
}

interface ContextPillProps {
  icon: React.ReactNode;
  label: string;
  count?: number;
  status?: "ok" | "warn";
  active: boolean;
  onClick: () => void;
}

function ContextPill({
  icon,
  label,
  count,
  status,
  active,
  onClick,
}: ContextPillProps) {
  const hasCount = typeof count === "number" && count > 0;
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs transition-colors",
        "hover:bg-muted/60",
        active
          ? "border-foreground/30 bg-muted text-foreground"
          : "border-border bg-background text-muted-foreground",
        status === "warn" && !active && "border-amber-500/40 text-amber-700 dark:text-amber-400",
        status === "ok" && !active && "border-emerald-500/30 text-foreground",
      )}
    >
      {icon}
      <span className={cn("truncate max-w-[160px]", status === "ok" && "font-mono")}>
        {label}
      </span>
      {hasCount && (
        <span className="ml-0.5 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-foreground/10 px-1 text-[10px] font-medium text-foreground">
          {count}
        </span>
      )}
      {status === "warn" && !hasCount && (
        <span className="ml-0.5 text-amber-600 dark:text-amber-400">·</span>
      )}
    </button>
  );
}

interface InlinePanelProps {
  description: string;
  cta: string;
  onClick: () => void;
  bare?: boolean;
}

function InlinePanel({ description, cta, onClick, bare }: InlinePanelProps) {
  const content = (
    <div className="flex items-center gap-3">
      <p className="flex-1 text-sm text-muted-foreground">{description}</p>
      <Button size="sm" onClick={onClick}>
        {cta}
      </Button>
    </div>
  );
  if (bare) return content;
  return (
    <div className="rounded-md border bg-muted/20 px-3 py-3">{content}</div>
  );
}

interface ContextSheetCapabilities {
  transcript?: boolean;
  spreadsheet?: boolean;
  github?: boolean;
  file?: boolean;
}

interface ContextSheetHandlers {
  onUnlink: (itemId: string, itemTitle: string) => void;
  onImportTranscript?: () => void;
  onImportSpreadsheet?: () => void;
  onImportGitHub?: () => void;
  onUploadFiles?: (files: FileList) => void;
}

interface ContextSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  ritualLabel: string;
  linkedItems: ContextItem[];
  capabilities: ContextSheetCapabilities;
  handlers: ContextSheetHandlers;
  customGitHubPanel?: React.ReactNode;
  /** Mostra spinner no painel de documentos enquanto o upload roda. */
  uploadingFile?: boolean;
}

export default function ContextSheet({
  open,
  onOpenChange,
  ritualLabel,
  linkedItems,
  capabilities,
  handlers,
  customGitHubPanel,
  uploadingFile,
}: ContextSheetProps) {
  const [activePill, setActivePill] = useState<PillKind | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Abre modal de importação fechando o sheet primeiro — sem isso, o backdrop
  // do sheet captura os cliques do modal e parece que "nada acontece".
  const openImport = (kind: PillKind) => {
    onOpenChange(false);
    setTimeout(() => {
      if (kind === "transcript" && handlers.onImportTranscript) {
        handlers.onImportTranscript();
      } else if (kind === "spreadsheet" && handlers.onImportSpreadsheet) {
        handlers.onImportSpreadsheet();
      } else if (kind === "github" && handlers.onImportGitHub) {
        handlers.onImportGitHub();
      }
    }, 50);
  };

  const transcriptCount = linkedItems.filter(
    (item) => item.kind === "transcript",
  ).length;
  const spreadsheetCount = linkedItems.filter(
    (item) => item.kind === "spreadsheet",
  ).length;
  const githubCount = linkedItems.filter((item) => item.kind === "github").length;
  const documentCount = linkedItems.filter(
    (item) => item.kind === "document",
  ).length;

  const togglePill = (kind: PillKind) =>
    setActivePill((cur) => (cur === kind ? null : kind));

  function sourceIcon(kind: PillKind) {
    if (kind === "spreadsheet") {
      return <FileSpreadsheet className="h-3.5 w-3.5 text-muted-foreground shrink-0" />;
    }
    if (kind === "github") {
      return <GitBranch className="h-3.5 w-3.5 text-muted-foreground shrink-0" />;
    }
    if (kind === "document") {
      return <File className="h-3.5 w-3.5 text-muted-foreground shrink-0" />;
    }
    return <FileText className="h-3.5 w-3.5 text-muted-foreground shrink-0" />;
  }

  return (
    <ResponsiveSheet open={open} onOpenChange={onOpenChange}>
      <ResponsiveSheetContent size="sm" showCloseButton>
        <ResponsiveSheetHeader>
          <SheetTitle className="flex items-center gap-2">
            <FileText className="h-4 w-4" />
            Insumos · {ritualLabel}
          </SheetTitle>
        </ResponsiveSheetHeader>

        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-5">
          {/* Pills row — fontes de contexto */}
          <section className="space-y-3">
            <div className="flex flex-wrap gap-2">
              {capabilities.transcript && (
                <ContextPill
                  icon={<FileText className="h-3.5 w-3.5" />}
                  label="Reunião"
                  count={transcriptCount}
                  active={activePill === "transcript"}
                  onClick={() => togglePill("transcript")}
                />
              )}
              {capabilities.spreadsheet && (
                <ContextPill
                  icon={<FileSpreadsheet className="h-3.5 w-3.5" />}
                  label="Planilha"
                  count={spreadsheetCount}
                  active={activePill === "spreadsheet"}
                  onClick={() => togglePill("spreadsheet")}
                />
              )}
              {capabilities.file && (
                <ContextPill
                  icon={<File className="h-3.5 w-3.5" />}
                  label="Documento"
                  count={documentCount}
                  active={activePill === "document"}
                  onClick={() => togglePill("document")}
                />
              )}
              {/* GitHub sempre por último — chip à direita. */}
              {capabilities.github && (
                <ContextPill
                  icon={<GitBranch className="h-3.5 w-3.5" />}
                  label={githubCount > 0 ? `GitHub (${githubCount})` : "Repositório"}
                  status={githubCount > 0 ? "ok" : "warn"}
                  active={activePill === "github"}
                  onClick={() => togglePill("github")}
                />
              )}
            </div>

            {activePill === "transcript" && capabilities.transcript && (
              <InlinePanel
                description={`${ritualLabel} usa a transcrição como contexto.`}
                cta="Importar reunião"
                onClick={() => openImport("transcript")}
              />
            )}

            {activePill === "spreadsheet" && capabilities.spreadsheet && (
              <InlinePanel
                description="Importar dados de planilha (CSV)."
                cta="Importar planilha"
                onClick={() => openImport("spreadsheet")}
              />
            )}

            {activePill === "github" && capabilities.github && (
              <div className="rounded-md border bg-muted/20 px-3 py-3 space-y-2">
                {customGitHubPanel ? (
                  customGitHubPanel
                ) : (
                  <InlinePanel
                    description="Linkar repositório, PR ou issue do GitHub."
                    cta="Importar do GitHub"
                    onClick={() => openImport("github")}
                    bare
                  />
                )}
              </div>
            )}

            {activePill === "document" && capabilities.file && (
              <div className="rounded-md border bg-muted/20 px-3 py-3 space-y-1.5">
                <div className="flex items-center gap-3">
                  <p className="flex-1 text-sm text-muted-foreground">
                    Anexar documentos (PDF, DOCX, TXT, MD, HTML, CSV, XLSX) como
                    contexto.
                  </p>
                  <Button
                    size="sm"
                    disabled={uploadingFile}
                    onClick={() => fileInputRef.current?.click()}
                  >
                    {uploadingFile ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      "Anexar arquivo"
                    )}
                  </Button>
                </div>
                <input
                  ref={fileInputRef}
                  type="file"
                  multiple
                  accept={FILE_ACCEPT}
                  className="hidden"
                  onChange={(e) => {
                    if (e.target.files?.length) {
                      handlers.onUploadFiles?.(e.target.files);
                    }
                    e.target.value = "";
                  }}
                />
              </div>
            )}
          </section>

          {/* Fontes importadas */}
          <section className="space-y-2">
            <h3 className="text-xs uppercase tracking-wider text-muted-foreground">
              Fontes importadas
            </h3>
            {linkedItems.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                Nenhuma fonte importada ainda.
              </p>
            ) : (
              <ul className="divide-y">
                {linkedItems.map((item) => (
                  <li key={item.id} className="flex items-center gap-2 py-3">
                    {sourceIcon(item.kind)}
                    <div className="flex-1 min-w-0">
                      <p className="text-sm truncate">
                        {item.title ?? "Fonte sem título"}
                      </p>
                      {(item.source || item.capturedAt) && (
                        <p className="text-xs text-muted-foreground">
                          {item.source}
                          {item.capturedAt ? ` · ${item.capturedAt}` : ""}
                        </p>
                      )}
                    </div>
                    {item.weight && (
                      <Badge variant="outline" className="text-xs shrink-0 capitalize">
                        {item.weight}
                      </Badge>
                    )}
                    <button
                      type="button"
                      className="text-muted-foreground hover:text-destructive transition-colors shrink-0"
                      title="Desvincular"
                      onClick={() =>
                        handlers.onUnlink(item.id, item.title ?? "esta fonte")
                      }
                    >
                      <Unlink className="h-3.5 w-3.5" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>

        <ResponsiveSheetFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Fechar
          </Button>
        </ResponsiveSheetFooter>
      </ResponsiveSheetContent>
    </ResponsiveSheet>
  );
}
