"use client";

import { useState } from "react";
import {
  FileSpreadsheet,
  FileText,
  GitBranch,
  Unlink,
  RefreshCw,
  Loader2,
} from "lucide-react";
import { toast } from "sonner";
import {
  ResponsiveSheet,
  ResponsiveSheetContent,
  ResponsiveSheetHeader,
  ResponsiveSheetFooter,
} from "@/components/ui/responsive-sheet";
import { SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { TranscriptModal } from "@/components/design-session/transcript-modal";
import { SpreadsheetImportModal } from "@/components/planning/spreadsheet-import-modal";
import { GitHubRepoModal } from "@/components/planning/github-repo-modal";
import { fmtDate } from "@/lib/date-utils";
import { cn } from "@/lib/utils";

interface LinkedTranscript {
  transcriptRefId: string;
  transcript: {
    id: string;
    title: string | null;
    source: string;
    capturedAt: string | null;
  } | null;
  weight: string;
}

interface ProjectRepo {
  owner: string | null;
  name: string | null;
  branch: string | null;
  manifestUpdatedAt: string | null;
}

function sourceIcon(source: string | undefined) {
  if (source === "spreadsheet") {
    return <FileSpreadsheet className="h-3.5 w-3.5 text-muted-foreground shrink-0" />;
  }
  return <FileText className="h-3.5 w-3.5 text-muted-foreground shrink-0" />;
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

interface ContextSheetProps {
  planningId: string;
  projectId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  linkedTranscripts: LinkedTranscript[];
  projectRepo: ProjectRepo | null;
  onUnlink: (transcriptRefId: string, title: string) => void;
  onImported: () => void;
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
}: ContextSheetProps) {
  type PillKind = "transcript" | "spreadsheet" | "github";
  const [activePill, setActivePill] = useState<PillKind | null>(null);
  const [transcriptModalOpen, setTranscriptModalOpen] = useState(false);
  const [spreadsheetModalOpen, setSpreadsheetModalOpen] = useState(false);
  const [githubModalOpen, setGithubModalOpen] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  // Abre modal de importação fechando o sheet primeiro — sem isso, o backdrop
  // do sheet captura os cliques do modal e parece que "nada acontece".
  const openImport = (kind: PillKind) => {
    onOpenChange(false);
    setTimeout(() => {
      if (kind === "transcript") setTranscriptModalOpen(true);
      else if (kind === "spreadsheet") setSpreadsheetModalOpen(true);
      else setGithubModalOpen(true);
    }, 50);
  };

  const repoConfigured = Boolean(
    projectRepo && projectRepo.owner && projectRepo.name,
  );

  const transcriptCount = linkedTranscripts.filter(
    (l) => l.transcript?.source !== "spreadsheet",
  ).length;
  const spreadsheetCount = linkedTranscripts.filter(
    (l) => l.transcript?.source === "spreadsheet",
  ).length;

  const togglePill = (kind: PillKind) =>
    setActivePill((cur) => (cur === kind ? null : kind));

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

  return (
    <>
      <ResponsiveSheet open={open} onOpenChange={onOpenChange}>
        <ResponsiveSheetContent size="sm" showCloseButton>
          <ResponsiveSheetHeader>
            <SheetTitle className="flex items-center gap-2">
              <FileText className="h-4 w-4" />
              Contexto da planning
            </SheetTitle>
          </ResponsiveSheetHeader>

          <div className="flex-1 overflow-y-auto px-6 py-4 space-y-5">
            {/* Pills row — fontes de contexto */}
            <section className="space-y-3">
              <div className="flex flex-wrap gap-2">
                <ContextPill
                  icon={<FileText className="h-3.5 w-3.5" />}
                  label="Reunião"
                  count={transcriptCount}
                  active={activePill === "transcript"}
                  onClick={() => togglePill("transcript")}
                />
                <ContextPill
                  icon={<FileSpreadsheet className="h-3.5 w-3.5" />}
                  label="Planilha"
                  count={spreadsheetCount}
                  active={activePill === "spreadsheet"}
                  onClick={() => togglePill("spreadsheet")}
                />
                <ContextPill
                  icon={<GitBranch className="h-3.5 w-3.5" />}
                  label={
                    repoConfigured
                      ? `${projectRepo!.owner}/${projectRepo!.name}`
                      : "Repositório"
                  }
                  status={repoConfigured ? "ok" : "warn"}
                  active={activePill === "github"}
                  onClick={() => togglePill("github")}
                />
              </div>

              {activePill === "transcript" && (
                <InlinePanel
                  description="Vitória usa a transcrição como contexto da planning."
                  cta="Importar reunião"
                  onClick={() => openImport("transcript")}
                />
              )}

              {activePill === "spreadsheet" && (
                <InlinePanel
                  description="Importar tasks de XLSX/CSV pra dentro da planning."
                  cta="Importar planilha"
                  onClick={() => openImport("spreadsheet")}
                />
              )}

              {activePill === "github" && (
                <div className="rounded-md border bg-muted/20 px-3 py-3 space-y-2">
                  {repoConfigured ? (
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
                          onClick={() => openImport("github")}
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
                  ) : (
                    <InlinePanel
                      description="Vitória precisa do código pra dar contexto às tasks."
                      cta="Linkar repositório"
                      onClick={() => openImport("github")}
                      bare
                    />
                  )}
                </div>
              )}
            </section>

            {/* Fontes importadas (transcripts/planilhas) */}
            <section className="space-y-2">
              <h3 className="text-xs uppercase tracking-wider text-muted-foreground">
                Fontes importadas
              </h3>
              {linkedTranscripts.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  Nenhuma fonte importada ainda.
                </p>
              ) : (
                <ul className="divide-y">
                  {linkedTranscripts.map((l) => (
                    <li
                      key={l.transcriptRefId}
                      className="flex items-center gap-2 py-3"
                    >
                      {sourceIcon(l.transcript?.source)}
                      <div className="flex-1 min-w-0">
                        <p className="text-sm truncate">
                          {l.transcript?.title ?? "Fonte sem título"}
                        </p>
                        {(l.transcript?.source || l.transcript?.capturedAt) && (
                          <p className="text-xs text-muted-foreground">
                            {l.transcript?.source}
                            {l.transcript?.capturedAt
                              ? ` · ${fmtDate(l.transcript.capturedAt)}`
                              : ""}
                          </p>
                        )}
                      </div>
                      <Badge variant="outline" className="text-xs shrink-0 capitalize">
                        {l.weight}
                      </Badge>
                      <button
                        type="button"
                        className="text-muted-foreground hover:text-destructive transition-colors shrink-0"
                        title="Desvincular"
                        onClick={() =>
                          onUnlink(
                            l.transcriptRefId,
                            l.transcript?.title ?? "esta fonte",
                          )
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

      <SpreadsheetImportModal
        planningId={planningId}
        open={spreadsheetModalOpen}
        onOpenChange={setSpreadsheetModalOpen}
        onImported={onImported}
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
