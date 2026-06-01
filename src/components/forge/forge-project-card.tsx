"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  DollarSign,
  ExternalLink,
  FileText,
  Flame,
  Lightbulb,
  Loader2,
  Maximize2,
  Play,
  RotateCcw,
  Square,
  Star,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { StatusChip } from "@/components/ui/status-chip";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import type {
  ForgePrdItem,
  LoadableSession,
  ProjectForgeSummary,
} from "@/lib/dal/forge-project";
import type { ChipTone } from "@/lib/status-chips";
import type { PrdState } from "@/lib/forge/prd-fs";
import { forgeRunChip } from "@/lib/forge/run-state";
import { PrdDetailSheet } from "@/components/prd/prd-detail-sheet";

type ProjectInfo = {
  id: string;
  name: string;
  referenceKey: string | null;
  repoUrl?: string | null;
  githubRepoOwner?: string | null;
  githubRepoName?: string | null;
};

type ForgeProjectCardProps = {
  project: ProjectInfo;
  summary: ProjectForgeSummary;
  /** Callback após mutation (load-session / runs) pra parent re-fetch. */
  onChanged?: () => void;
};

function formatCost(usd: number): string {
  return `$${usd.toFixed(2)}`;
}

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString("pt-BR", {
      day: "2-digit",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

function prdStateTone(state: PrdState): ChipTone {
  switch (state) {
    case "backlog":
      return "slate";
    case "ready":
      return "blue";
    case "in-progress":
      return "amber";
    case "blocked":
      return "red";
    case "done":
      return "green";
    case "archive":
      return "muted";
    default:
      return "muted";
  }
}


function runStatusTone(status: string): ChipTone {
  switch (status) {
    case "done":
      return "green";
    case "running":
      return "blue";
    case "error":
      return "red";
    case "aborted":
      return "slate";
    default:
      return "muted";
  }
}

export function ForgeProjectCard({
  project,
  summary,
  onChanged,
}: ForgeProjectCardProps) {
  const {
    prds,
    dbPrds,
    forgeSourceSessionId,
    runs,
    activeRun,
    lastFinishedRun,
    lastFinishedRunFailedPrdRefs,
    cost7d,
    runCount7d,
  } = summary;

  // Modo DB-sourced: tem session carregada → mostra dbPrds.
  // Modo legado FS: sem session → mostra prds do filesystem (Ralph).
  const isDbMode = !!forgeSourceSessionId;
  const hasData = isDbMode ? dbPrds.length > 0 : prds.length > 0 || runs.length > 0;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Resumo do projeto</CardTitle>
        <CardDescription>
          {isDbMode
            ? "Session carregada, PRDs prontos pra forja e histórico de runs."
            : "PRDs vinculados, runs recentes e custo dos últimos 7 dias."}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Source session loader — sempre visível */}
        <SessionLoader
          projectId={project.id}
          loadedSessionId={forgeSourceSessionId}
          onChanged={onChanged}
        />

        {/* Empty state — só quando legacy FS mode + sem dados */}
        {!isDbMode && !hasData ? (
          <div className="flex flex-col items-center gap-4 py-8 text-center">
            <Lightbulb className="size-12 text-muted-foreground/40" />
            <div>
              <p className="text-sm font-medium">
                Nenhum PRD ou run neste projeto ainda
              </p>
              <p className="text-xs text-muted-foreground">
                Carregue uma PRD Session acima para começar.
              </p>
            </div>
          </div>
        ) : (
          <>
            {/* Stats grid */}
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <div className="rounded-lg border p-4">
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <FileText className="size-4" />
                  <span>PRDs {isDbMode ? "carregados" : "vinculados"}</span>
                </div>
                <div className="mt-2 text-2xl font-bold">
                  {isDbMode ? dbPrds.length : prds.length}
                </div>
              </div>

              <div className="rounded-lg border p-4">
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Play className="size-4" />
                  <span>Runs (7d)</span>
                </div>
                <div className="mt-2 text-2xl font-bold">{runCount7d}</div>
              </div>

              <div className="rounded-lg border p-4">
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <DollarSign className="size-4" />
                  <span>Custo (7d)</span>
                </div>
                <div className="mt-2 text-2xl font-bold">
                  {formatCost(cost7d)}
                </div>
              </div>
            </div>

            {/* PRDs list */}
            {isDbMode ? (
              dbPrds.length > 0 && (
                <DbPrdList
                  project={project}
                  prds={dbPrds}
                  activeRun={activeRun}
                  lastFinishedRun={lastFinishedRun}
                  lastFinishedRunFailedPrdRefs={lastFinishedRunFailedPrdRefs}
                  onChanged={onChanged}
                />
              )
            ) : (
              prds.length > 0 && <FsPrdList prds={prds} />
            )}

            {/* Runs list — cada item linka pro Spike (stream ao vivo) */}
            {runs.length > 0 && (
              <div>
                <h3 className="mb-3 text-sm font-semibold">Últimas runs</h3>
                <div className="space-y-2">
                  {runs.map((run) => (
                    <Link
                      key={run.id}
                      href={`/projects/${project.id}/forge/runs/${run.id}`}
                      className="group flex flex-wrap items-center justify-between gap-2 rounded-md border p-3 text-sm hover:bg-accent/40 transition-colors"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <Play className="size-4 shrink-0 text-muted-foreground" />
                          <span className="truncate font-mono text-xs">
                            {run.id.slice(0, 8)}
                          </span>
                          <ExternalLink className="size-3 shrink-0 opacity-0 group-hover:opacity-60 transition-opacity" />
                        </div>
                        <p className="mt-1 text-xs text-muted-foreground">
                          {formatDate(run.createdAt)}
                        </p>
                      </div>
                      <div className="flex shrink-0 flex-wrap items-center gap-2">
                        {run.costUsdTotal ? (
                          <span className="text-xs text-muted-foreground">
                            {formatCost(run.costUsdTotal)}
                          </span>
                        ) : null}
                        <StatusChip tone={runStatusTone(run.status)} size="sm">
                          {run.status}
                        </StatusChip>
                      </div>
                    </Link>
                  ))}
                </div>
              </div>
            )}

          </>
        )}
      </CardContent>
    </Card>
  );
}

// ─── Session Loader ─────────────────────────────────────────────────────────

function SessionLoader({
  projectId,
  loadedSessionId,
  onChanged,
}: {
  projectId: string;
  loadedSessionId: string | null;
  onChanged?: () => void;
}) {
  const [sessions, setSessions] = useState<LoadableSession[] | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/forge/projects/${projectId}/loadable-sessions`, {
      cache: "no-store",
    })
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (cancelled || !data) return;
        const list = (data.sessions ?? []) as LoadableSession[];
        setSessions(list);
        if (loadedSessionId) {
          setSelectedId(loadedSessionId);
        } else {
          // Default: Main (já vem ordenada no topo) se tiver
          const main = list.find((s) => s.isMain);
          setSelectedId(main?.id ?? list[0]?.id ?? null);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [projectId, loadedSessionId]);

  const handleLoad = async () => {
    if (!selectedId) return;
    setLoading(true);
    try {
      const res = await fetch(
        `/api/forge/projects/${projectId}/load-session`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ designSessionId: selectedId }),
        },
      );
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(json.error ?? "Falha ao carregar session");
        return;
      }
      toast.success("Session carregada na Forja.");
      onChanged?.();
    } finally {
      setLoading(false);
    }
  };

  const handleUnload = async () => {
    setLoading(true);
    try {
      const res = await fetch(
        `/api/forge/projects/${projectId}/load-session`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ designSessionId: null }),
        },
      );
      if (!res.ok) {
        toast.error("Falha ao desvincular session");
        return;
      }
      toast.success("Session desvinculada.");
      onChanged?.();
    } finally {
      setLoading(false);
    }
  };

  if (!sessions) {
    return (
      <div className="rounded-md border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
        Carregando sessions…
      </div>
    );
  }

  if (sessions.length === 0) {
    return (
      <div className="rounded-md border border-dashed bg-muted/30 px-3 py-3 text-xs text-muted-foreground">
        Nenhuma PRD Session neste projeto ainda. Crie uma na aba Sessions pra
        carregar PRDs aqui.
      </div>
    );
  }

  const loaded = loadedSessionId
    ? sessions.find((s) => s.id === loadedSessionId)
    : null;

  if (loaded) {
    return (
      <div className="rounded-md border bg-accent/30 px-3 py-2.5 flex items-center gap-3 flex-wrap">
        <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Session carregada
        </span>
        {loaded.isMain && (
          <span className="inline-flex items-center gap-1 rounded-sm border border-amber-300 bg-amber-50 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-amber-700 dark:border-amber-900/60 dark:bg-amber-950/40 dark:text-amber-300">
            <Star className="size-2.5 fill-current" /> Main
          </span>
        )}
        <span className="text-sm font-medium truncate min-w-0 flex-1">
          {loaded.title}
        </span>
        <span className="text-[11px] text-muted-foreground tabular-nums">
          {loaded.prdReady}/{loaded.prdTotal} prontos
        </span>
        <Button
          variant="ghost"
          size="sm"
          onClick={handleUnload}
          disabled={loading}
          className="h-7 text-xs"
        >
          Desvincular
        </Button>
      </div>
    );
  }

  return (
    <div className="rounded-md border bg-card px-3 py-3 space-y-3">
      <div className="flex items-center gap-2">
        <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Carregar PRDs de uma session
        </span>
      </div>
      <div className="flex items-center gap-2 flex-wrap">
        <Select
          value={selectedId ?? ""}
          onValueChange={(v) => setSelectedId(v)}
        >
          <SelectTrigger className="h-9 flex-1 min-w-[260px]">
            <SelectValue placeholder="Selecione uma session…" />
          </SelectTrigger>
          <SelectContent>
            {sessions.map((s) => (
              <SelectItem key={s.id} value={s.id}>
                <span className="flex items-center gap-2">
                  {s.isMain && (
                    <Star className="size-3 text-amber-500 fill-amber-500" />
                  )}
                  <span className="truncate">{s.title}</span>
                  <span className="text-[11px] text-muted-foreground tabular-nums">
                    {s.prdReady}/{s.prdTotal}
                  </span>
                </span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button
          onClick={handleLoad}
          disabled={!selectedId || loading}
          className="h-9"
        >
          {loading ? (
            <Loader2 className="size-3.5 mr-1.5 animate-spin" />
          ) : null}
          Carregar
        </Button>
      </div>
    </div>
  );
}

// ─── PRD lists ─────────────────────────────────────────────────────────────

function DbPrdList({
  project,
  prds,
  activeRun,
  lastFinishedRun,
  lastFinishedRunFailedPrdRefs,
  onChanged,
}: {
  project: ProjectInfo;
  prds: ForgePrdItem[];
  activeRun: ProjectForgeSummary["activeRun"];
  lastFinishedRun: ProjectForgeSummary["lastFinishedRun"];
  lastFinishedRunFailedPrdRefs: string[];
  onChanged?: () => void;
}) {
  const [specPrdId, setSpecPrdId] = useState<string | null>(null);
  return (
    <div>
      <div className="mb-3 flex items-center justify-between gap-2 flex-wrap">
        <h3 className="text-sm font-semibold">PRDs carregados</h3>
        <div className="flex items-center gap-2">
          <Link href={`/projects/${project.id}/forge/kanban`}>
            <Button size="sm" variant="outline" className="h-8">
              <ExternalLink className="size-3.5 mr-1.5" />
              Abrir kanban
            </Button>
          </Link>
          <SmartRunButton
            project={project}
            prds={prds}
            activeRun={activeRun}
            lastFinishedRun={lastFinishedRun}
            lastFinishedRunFailedPrdRefs={lastFinishedRunFailedPrdRefs}
            onChanged={onChanged}
          />
        </div>
      </div>
      <div className="space-y-2">
        {prds.map((prd) => (
          <Link
            key={prd.id}
            href={`/projects/${project.id}/forge/prds/${prd.id}`}
            className="flex flex-wrap items-center justify-between gap-2 rounded-md border p-3 text-sm hover:bg-accent/40 transition-colors"
          >
            <div className="flex min-w-0 flex-1 items-center gap-2">
              <FileText className="size-4 shrink-0 text-muted-foreground" />
              <span className="font-mono text-[10px] text-muted-foreground tabular-nums shrink-0">
                {prd.reference}
              </span>
              <span className="truncate font-medium">{prd.title}</span>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <span className="text-[10px] text-muted-foreground tabular-nums">
                {prd.acCount} AC
              </span>
              {(() => {
                const chip = forgeRunChip(prd.runState);
                return (
                  <StatusChip tone={chip.tone} size="sm">
                    {chip.label}
                  </StatusChip>
                );
              })()}
              <span
                role="button"
                tabIndex={0}
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  setSpecPrdId(prd.id);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    e.stopPropagation();
                    setSpecPrdId(prd.id);
                  }
                }}
                aria-label="Ver spec do PRD"
                className="inline-flex size-6 shrink-0 cursor-pointer items-center justify-center rounded-sm text-muted-foreground hover:bg-accent hover:text-foreground"
              >
                <Maximize2 className="size-3.5" />
              </span>
            </div>
          </Link>
        ))}
      </div>

      <PrdDetailSheet
        prdId={specPrdId}
        onOpenChange={(open) => !open && setSpecPrdId(null)}
        onChanged={() => onChanged?.()}
      />
    </div>
  );
}

// ─── Smart Run Button ──────────────────────────────────────────────────────

type RunStatus =
  | "queued"
  | "running"
  | "completed"
  | "failed"
  | "cancelled"
  | string;

function fmtElapsed(startedAt: string | null): string {
  if (!startedAt) return "";
  const diff = Date.now() - new Date(startedAt).getTime();
  const sec = Math.max(0, Math.round(diff / 1000));
  if (sec < 60) return `${sec}s`;
  const min = Math.floor(sec / 60);
  const remSec = sec % 60;
  return remSec > 0 ? `${min}m${remSec}s` : `${min}m`;
}

function SmartRunButton({
  project,
  prds,
  activeRun,
  lastFinishedRun,
  lastFinishedRunFailedPrdRefs,
  onChanged,
}: {
  project: ProjectInfo;
  prds: ForgePrdItem[];
  activeRun: ProjectForgeSummary["activeRun"];
  lastFinishedRun: ProjectForgeSummary["lastFinishedRun"];
  lastFinishedRunFailedPrdRefs: string[];
  onChanged?: () => void;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [, setTick] = useState(0);

  // Clock pra atualizar elapsed em "Rodando"
  useEffect(() => {
    if (!activeRun) return;
    const id = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(id);
  }, [activeRun]);

  const readyCount = prds.filter(
    (p) => p.status === "approved" || p.status === "ready",
  ).length;
  const hasRepo = !!(project.githubRepoOwner && project.githubRepoName);

  const blockReason = !hasRepo
    ? "Conecte o repo GitHub deste projeto antes de rodar."
    : readyCount === 0
      ? "Aprove ao menos 1 PRD nesta session pra rodar a Forja."
      : null;

  const handleRun = async (retryFailed = false) => {
    setBusy(true);
    try {
      const res = await fetch(`/api/forge/projects/${project.id}/runs`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(retryFailed ? { retryFailed: true } : {}),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(json.error ?? "Falha ao iniciar run");
        return;
      }
      toast.success(
        `Run criado · ${json.prdCount} PRD${json.prdCount > 1 ? "s" : ""} no manifest`,
      );
      onChanged?.();
      if (json.runId) {
        router.push(`/projects/${project.id}/forge/kanban`);
      }
    } finally {
      setBusy(false);
    }
  };

  const handleCancel = async () => {
    if (!activeRun) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/forge/runs/${activeRun.id}/cancel`, {
        method: "POST",
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(json.error ?? "Falha ao cancelar run");
        return;
      }
      const wasRunning = activeRun.status === "running";
      toast.success(
        wasRunning
          ? "Run cancelado. Worker termina story atual e para."
          : "Run cancelado.",
      );
      onChanged?.();
    } finally {
      setBusy(false);
    }
  };

  // ─── Estado 1: run ativo (queued/running) — botão "Rodando · Cancelar"
  if (activeRun) {
    const status = activeRun.status as RunStatus;
    const isQueued = status === "queued";
    const label = isQueued
      ? "Aguardando daemon"
      : `Rodando · ${fmtElapsed(activeRun.startedAt ?? activeRun.createdAt)}`;
    return (
      <div className="flex items-center gap-2">
        <Button
          size="sm"
          variant="outline"
          disabled
          className="h-8 cursor-default opacity-100"
        >
          <Loader2 className="size-3.5 mr-1.5 animate-spin text-amber-600 dark:text-amber-400" />
          {label}
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={handleCancel}
          disabled={busy}
          className="h-8 text-rose-600 hover:bg-rose-50 hover:text-rose-700 dark:text-rose-400 dark:hover:bg-rose-950/40"
        >
          {busy ? (
            <Loader2 className="size-3.5 mr-1.5 animate-spin" />
          ) : (
            <Square className="size-3.5 mr-1.5 fill-current" />
          )}
          Cancelar
        </Button>
      </div>
    );
  }

  // ─── Estado 2: blocked (sem repo / sem PRD approved)
  if (blockReason) {
    return (
      <TooltipProvider delay={150}>
        <Tooltip>
          <TooltipTrigger
            render={
              <span>
                <Button size="sm" disabled className="h-8">
                  <Flame className="size-3.5 mr-1.5" />
                  Disparar run
                </Button>
              </span>
            }
          />
          <TooltipContent>{blockReason}</TooltipContent>
        </Tooltip>
      </TooltipProvider>
    );
  }

  // ─── Estado 3: último run falhou + tem PRDs failed pra retry
  const lastStatus = lastFinishedRun?.status as RunStatus | undefined;
  const canRetryFailed =
    lastStatus === "error" && lastFinishedRunFailedPrdRefs.length > 0;

  if (canRetryFailed) {
    const failedN = lastFinishedRunFailedPrdRefs.length;
    return (
      <div className="flex items-center gap-2">
        <Button
          size="sm"
          variant="outline"
          onClick={() => handleRun(true)}
          disabled={busy}
          className="h-8 border-amber-400 text-amber-700 hover:bg-amber-50 dark:border-amber-700/60 dark:text-amber-300 dark:hover:bg-amber-950/40"
        >
          {busy ? (
            <Loader2 className="size-3.5 mr-1.5 animate-spin" />
          ) : (
            <RotateCcw className="size-3.5 mr-1.5" />
          )}
          Tentar {failedN} de novo
        </Button>
        <Button
          size="sm"
          onClick={() => handleRun(false)}
          disabled={busy}
          className="h-8"
        >
          <Flame className="size-3.5 mr-1.5" />
          Run novo
        </Button>
      </div>
    );
  }

  // ─── Estado 4: último run concluído ok — disparar novo
  const lastDone = lastStatus === "done";
  if (lastDone) {
    return (
      <Button
        size="sm"
        onClick={() => handleRun(false)}
        disabled={busy}
        className="h-8"
      >
        {busy ? (
          <Loader2 className="size-3.5 mr-1.5 animate-spin" />
        ) : (
          <Flame className="size-3.5 mr-1.5" />
        )}
        Disparar novo run
      </Button>
    );
  }

  // ─── Estado 5: idle (nunca rodou ou só cancelled) — disparar
  return (
    <Button
      size="sm"
      onClick={() => handleRun(false)}
      disabled={busy}
      className="h-8"
    >
      {busy ? (
        <Loader2 className="size-3.5 mr-1.5 animate-spin" />
      ) : (
        <Flame className="size-3.5 mr-1.5" />
      )}
      Disparar run
    </Button>
  );
}

function FsPrdList({ prds }: { prds: ProjectForgeSummary["prds"] }) {
  return (
    <div>
      <h3 className="mb-3 text-sm font-semibold">
        PRDs vinculados (legacy FS)
      </h3>
      <div className="space-y-2">
        {prds.slice(0, 5).map((prd) => (
          <div
            key={prd.slug}
            className="flex flex-wrap items-center justify-between gap-2 rounded-md border p-3 text-sm"
          >
            <div className="flex min-w-0 flex-1 items-center gap-2">
              <FileText className="size-4 shrink-0 text-muted-foreground" />
              <span className="truncate font-medium">{prd.title}</span>
            </div>
            <StatusChip tone={prdStateTone(prd.state)} size="sm">
              {prd.state}
            </StatusChip>
          </div>
        ))}
        {prds.length > 5 ? (
          <p className="text-xs text-muted-foreground">
            +{prds.length - 5} PRDs — veja todos no Forge Spike
          </p>
        ) : null}
      </div>
    </div>
  );
}
