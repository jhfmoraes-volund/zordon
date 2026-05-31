"use client";

import { use, useEffect, useState } from "react";
import Link from "next/link";
import {
  CheckCircle2,
  Circle,
  Clock,
  ExternalLink,
  Flame,
  Inbox,
  Loader2,
  PauseCircle,
  XCircle,
} from "lucide-react";
import { PageTitle } from "@/components/app-shell";
import { NoBuildersBanner } from "@/components/forge/no-builders-banner";
import { StatusChip } from "@/components/ui/status-chip";
import type { ChipTone } from "@/lib/status-chips";
import { cn } from "@/lib/utils";

type PrdRunState = "idle" | "pending" | "running" | "done" | "failed";

type LastEvent = { kind: string; ts: string; summary: string };

type PrdItem = {
  id: string;
  reference: string;
  title: string;
  status: string;
  oneLiner: string;
  acCount: number;
  updatedAt: string;
  runState: PrdRunState;
  runId: string | null;
  currentPhase: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  durationMs: number | null;
  lastEvents: LastEvent[];
};

type ColumnKey =
  | "inbox"
  | "ready"
  | "running"
  | "failed"
  | "done"
  | "archived";

const COLUMNS: Array<{
  key: ColumnKey;
  label: string;
  hint: string;
  tone: ChipTone;
  Icon: typeof Circle;
  ring: string;
}> = [
  {
    key: "inbox",
    label: "Inbox",
    hint: "draft / review",
    tone: "slate",
    Icon: Inbox,
    ring: "border-slate-300/40 dark:border-slate-700/60",
  },
  {
    key: "ready",
    label: "Pronto",
    hint: "approved, aguarda run",
    tone: "blue",
    Icon: Circle,
    ring: "border-blue-300/40 dark:border-blue-900/60",
  },
  {
    key: "running",
    label: "Rodando",
    hint: "em execução",
    tone: "amber",
    Icon: Loader2,
    ring: "border-amber-300/60 dark:border-amber-900/70",
  },
  {
    key: "failed",
    label: "Falhou",
    hint: "último run falhou",
    tone: "red",
    Icon: XCircle,
    ring: "border-rose-300/40 dark:border-rose-900/60",
  },
  {
    key: "done",
    label: "Concluído",
    hint: "último run ok",
    tone: "green",
    Icon: CheckCircle2,
    ring: "border-emerald-300/40 dark:border-emerald-900/60",
  },
  {
    key: "archived",
    label: "Arquivado",
    hint: "superseded",
    tone: "muted",
    Icon: PauseCircle,
    ring: "border-muted-foreground/20",
  },
];

function classifyPrd(p: PrdItem): ColumnKey {
  if (p.status === "superseded") return "archived";
  if (p.runState === "running" || p.runState === "pending") return "running";
  if (p.runState === "failed") return "failed";
  if (p.runState === "done") return "done";
  if (p.status === "draft" || p.status === "review") return "inbox";
  return "ready";
}

function statusTone(status: string): ChipTone {
  switch (status) {
    case "approved":
    case "ready":
      return "green";
    case "review":
      return "amber";
    case "draft":
      return "slate";
    case "superseded":
      return "muted";
    default:
      return "muted";
  }
}

function fmtDuration(ms: number | null): string {
  if (ms === null || ms < 0) return "—";
  if (ms < 1000) return `${ms}ms`;
  const sec = Math.round(ms / 1000);
  if (sec < 60) return `${sec}s`;
  const min = Math.floor(sec / 60);
  const remSec = sec % 60;
  return remSec > 0 ? `${min}m${remSec}s` : `${min}m`;
}

function fmtRelative(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return "agora";
  if (m < 60) return `${m}m atrás`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h atrás`;
  const d = Math.floor(h / 24);
  return `${d}d atrás`;
}

export default function ProjectForgeKanbanPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id: projectId } = use(params);
  const [prds, setPrds] = useState<PrdItem[] | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [activeRunId, setActiveRunId] = useState<string | null>(null);
  const [projectName, setProjectName] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [, setTick] = useState(0);

  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const r = await fetch(`/api/forge/projects/${projectId}/prds`, {
          cache: "no-store",
        });
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const json = await r.json();
        if (!alive) return;
        setPrds(json.prds ?? []);
        setSessionId(json.sessionId ?? null);
        setActiveRunId(json.activeRunId ?? null);
        setProjectName(json.project?.name ?? null);
        setError(null);
      } catch (err) {
        if (alive) setError(String(err));
      }
    };
    load();
    const interval = activeRunId ? 3000 : 10000;
    const id = setInterval(load, interval);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [projectId, activeRunId]);

  useEffect(() => {
    if (!activeRunId) return;
    const id = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(id);
  }, [activeRunId]);

  const byColumn = (key: ColumnKey) =>
    (prds ?? []).filter((p) => classifyPrd(p) === key);

  const runningCount = byColumn("running").length;
  const pendingInRun = (prds ?? []).filter(
    (p) => p.runState === "pending",
  ).length;
  const doneInRun = (prds ?? []).filter(
    (p) => p.runState === "done" && p.runId === activeRunId,
  ).length;

  return (
    <div className="flex flex-col gap-4 px-6 py-4">
      <PageTitle
        title={projectName ? `${projectName} · Forge Kanban` : "Forge Kanban"}
        backHref={`/projects/${projectId}?tab=forge`}
      />

      {/* Top status */}
      <div className="text-xs text-muted-foreground">
        {prds === null
          ? "carregando…"
          : `${prds.length} PRDs${sessionId ? "" : " · sem session carregada"}`}
      </div>

      <NoBuildersBanner />

      {/* HUD do run ativo */}
      {activeRunId && (
        <div className="flex items-center gap-3 rounded-lg border border-amber-300/60 bg-amber-50/40 px-4 py-3 dark:border-amber-900/60 dark:bg-amber-950/30 flex-wrap">
          <span className="relative flex size-2.5">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-amber-500 opacity-75" />
            <span className="relative inline-flex size-2.5 rounded-full bg-amber-500" />
          </span>
          <div className="flex flex-col">
            <span className="text-sm font-semibold text-amber-900 dark:text-amber-200">
              Run #{activeRunId.slice(0, 8)} em execução
            </span>
            <span className="text-xs text-amber-700/80 dark:text-amber-300/70 tabular-nums">
              {runningCount} rodando · {doneInRun} done · {pendingInRun}{" "}
              pendentes
            </span>
          </div>
          <Link
            href={`/forge-spike/runs/${activeRunId}`}
            className="ml-auto inline-flex items-center gap-1 text-xs font-semibold text-amber-700 hover:underline dark:text-amber-300"
          >
            <ExternalLink className="size-3" />
            stream completo
          </Link>
        </div>
      )}

      {!sessionId && prds !== null && (
        <div className="rounded-lg border border-dashed bg-muted/20 px-4 py-3 text-sm text-muted-foreground">
          Nenhuma PRD Session carregada neste projeto. Volte pro tab Forge e
          carregue uma session pra ver PRDs aqui.
        </div>
      )}

      {error && (
        <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {error}
        </div>
      )}

      {prds === null && !error && (
        <div className="rounded-lg border bg-card px-4 py-6 text-sm text-muted-foreground">
          Carregando PRDs…
        </div>
      )}

      {/* Kanban grid */}
      {prds && prds.length > 0 && (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
          {COLUMNS.map((col) => {
            const items = byColumn(col.key);
            const Icon = col.Icon;
            return (
              <div
                key={col.key}
                className={cn(
                  "flex flex-col gap-2 rounded-lg border bg-card/50 p-3",
                  col.ring,
                )}
              >
                <div className="flex items-center gap-2 pb-2 border-b">
                  <Icon
                    className={cn(
                      "size-3.5 shrink-0 text-muted-foreground",
                      col.key === "running" && "animate-spin",
                    )}
                  />
                  <span className="text-xs font-semibold uppercase tracking-wider">
                    {col.label}
                  </span>
                  <span className="ml-auto font-mono text-[10px] tabular-nums text-muted-foreground">
                    {items.length}
                  </span>
                </div>
                <p className="text-[10px] text-muted-foreground/70 -mt-1">
                  {col.hint}
                </p>
                <div className="flex flex-col gap-2">
                  {items.map((prd) => (
                    <PrdCard
                      key={prd.id}
                      prd={prd}
                      columnKey={col.key}
                      projectId={projectId}
                    />
                  ))}
                  {items.length === 0 && (
                    <div className="rounded-md border border-dashed bg-background/40 px-3 py-4 text-center text-[11px] text-muted-foreground/60 italic">
                      vazio
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {prds && prds.length === 0 && sessionId && (
        <div className="rounded-lg border bg-card px-4 py-6 text-sm text-muted-foreground">
          Esta session não tem PRDs ainda.
        </div>
      )}
    </div>
  );
}

function PrdCard({
  prd,
  columnKey,
  projectId,
}: {
  prd: PrdItem;
  columnKey: ColumnKey;
  projectId: string;
}) {
  const isRunning = columnKey === "running";
  const isFailed = columnKey === "failed";
  const isDone = columnKey === "done";

  return (
    <Link
      href={`/projects/${projectId}/prds/${prd.id}/run`}
      className={cn(
        "block rounded-md border bg-background p-3 transition-colors hover:bg-accent/40",
        isRunning && "border-amber-300/60 dark:border-amber-900/70",
      )}
    >
      <div className="flex items-center justify-between gap-2 mb-1">
        <span className="font-mono text-[10px] tabular-nums text-muted-foreground">
          {prd.reference}
        </span>
        {!isRunning && !isDone && !isFailed && (
          <StatusChip tone={statusTone(prd.status)} size="sm">
            {prd.status}
          </StatusChip>
        )}
      </div>
      <p className="text-[13px] font-semibold leading-tight">{prd.title}</p>
      {prd.oneLiner && !isRunning && (
        <p className="mt-1 text-[11px] text-muted-foreground line-clamp-2">
          {prd.oneLiner}
        </p>
      )}

      {/* Live phase (Rodando) */}
      {isRunning && (
        <div className="mt-2 rounded-sm bg-amber-50/60 px-2 py-1.5 dark:bg-amber-950/40">
          <div className="flex items-center gap-1.5">
            <span className="relative flex size-1.5">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-amber-500 opacity-75" />
              <span className="relative inline-flex size-1.5 rounded-full bg-amber-500" />
            </span>
            <span className="font-mono text-[10px] font-semibold text-amber-700 dark:text-amber-300">
              {prd.currentPhase ?? "queued"}
            </span>
            {prd.durationMs !== null && (
              <span className="ml-auto inline-flex items-center gap-1 font-mono text-[10px] tabular-nums text-amber-700/70 dark:text-amber-400/70">
                <Clock className="size-2.5" />
                {fmtDuration(prd.durationMs)}
              </span>
            )}
          </div>
          {prd.lastEvents.length > 0 && (
            <div className="mt-1 space-y-0.5">
              {prd.lastEvents.slice(-3).map((ev, i) => (
                <div
                  key={i}
                  className="truncate font-mono text-[9px] text-amber-700/80 dark:text-amber-300/70"
                  title={`${ev.kind} · ${ev.summary}`}
                >
                  <span className="text-muted-foreground">{ev.kind}</span>{" "}
                  {ev.summary}
                </div>
              ))}
            </div>
          )}
          {prd.runId && (
            <button
              type="button"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                window.open(`/forge-spike/runs/${prd.runId}`, "_blank");
              }}
              className="mt-1.5 inline-flex items-center gap-1 text-[10px] font-semibold text-blue-600 hover:underline dark:text-blue-400"
            >
              <ExternalLink className="size-2.5" />
              stream completo
            </button>
          )}
        </div>
      )}

      {/* Done / Failed footer */}
      {(isDone || isFailed) && (
        <div
          className={cn(
            "mt-2 flex items-center gap-2 border-t pt-2 text-[10px]",
            isFailed
              ? "border-rose-200/40 text-rose-600 dark:border-rose-900/60 dark:text-rose-400"
              : "border-emerald-200/40 text-emerald-600 dark:border-emerald-900/60 dark:text-emerald-400",
          )}
        >
          <span>{isFailed ? "✗" : "✓"}</span>
          <span className="font-mono tabular-nums">
            {fmtDuration(prd.durationMs)}
          </span>
          {prd.runId && (
            <button
              type="button"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                window.open(`/forge-spike/runs/${prd.runId}`, "_blank");
              }}
              className="ml-auto inline-flex items-center gap-1 font-semibold text-blue-600 hover:underline dark:text-blue-400"
            >
              <ExternalLink className="size-2.5" />
              stream
            </button>
          )}
        </div>
      )}

      {/* Footer simples (Inbox/Pronto/Arquivado) */}
      {!isRunning && !isDone && !isFailed && (
        <div className="mt-2 flex items-center justify-between text-[10px] text-muted-foreground">
          <span className="inline-flex items-center gap-1">
            <Flame className="size-2.5" />
            {prd.acCount} AC
          </span>
          <span>{fmtRelative(prd.updatedAt)}</span>
        </div>
      )}
    </Link>
  );
}
