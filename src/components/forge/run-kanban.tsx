"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { createClient } from "@supabase/supabase-js";
import {
  CheckCircle2,
  Circle,
  Clock,
  ExternalLink,
  Loader2,
  XCircle,
} from "lucide-react";
import { cn } from "@/lib/utils";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

type PrdStatus = "pending" | "running" | "done" | "failed";

type PrdLine = {
  id: string;
  reference: string;
  title: string;
  status: PrdStatus;
  startedAt: string | null;
  finishedAt: string | null;
  durationMs: number | null;
};

type Props = {
  runId: string;
  /** Se passado, o título de cada PRD vira link pra página do PRD do projeto. */
  projectId?: string;
};

const COLUMNS: Array<{
  key: PrdStatus;
  label: string;
  Icon: typeof Circle;
  tone: string;
  dotTone: string;
}> = [
  {
    key: "pending",
    label: "Pendente",
    Icon: Circle,
    tone: "border-slate-300 bg-slate-50 dark:border-slate-700 dark:bg-slate-900/40",
    dotTone: "bg-slate-400",
  },
  {
    key: "running",
    label: "Rodando",
    Icon: Loader2,
    tone: "border-blue-300 bg-blue-50 dark:border-blue-900/60 dark:bg-blue-950/30",
    dotTone: "bg-blue-500 animate-pulse",
  },
  {
    key: "done",
    label: "Pronto",
    Icon: CheckCircle2,
    tone: "border-emerald-300 bg-emerald-50 dark:border-emerald-900/60 dark:bg-emerald-950/30",
    dotTone: "bg-emerald-500",
  },
  {
    key: "failed",
    label: "Falhou",
    Icon: XCircle,
    tone: "border-rose-300 bg-rose-50 dark:border-rose-900/60 dark:bg-rose-950/30",
    dotTone: "bg-rose-500",
  },
];

function formatDuration(ms: number | null): string {
  if (ms === null || ms < 0) return "—";
  if (ms < 1000) return `${ms}ms`;
  const sec = Math.round(ms / 1000);
  if (sec < 60) return `${sec}s`;
  const min = Math.floor(sec / 60);
  const remSec = sec % 60;
  return remSec > 0 ? `${min}m${remSec}s` : `${min}m`;
}

function formatRelative(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const sec = Math.max(0, Math.round(diffMs / 1000));
  if (sec < 60) return `${sec}s`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m`;
  const hr = Math.floor(min / 60);
  return `${hr}h`;
}

export function RunKanban({ runId, projectId }: Props) {
  const [prds, setPrds] = useState<PrdLine[] | null>(null);
  const [runStatus, setRunStatus] = useState<string | null>(null);
  const [, setTick] = useState(0);

  useEffect(() => {
    let cancelled = false;

    const fetchStatus = async () => {
      try {
        const res = await fetch(`/api/forge/runs/${runId}/prd-status`, {
          cache: "no-store",
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = (await res.json()) as {
          prds: PrdLine[];
          runStatus: string;
        };
        if (cancelled) return;
        setPrds(data.prds);
        setRunStatus(data.runStatus);
      } catch (err) {
        console.error("[RunKanban] fetch failed:", err);
      }
    };

    fetchStatus();

    // Realtime subscribe em ForgeEvent pra refetch a cada novo evento do run.
    if (!SUPABASE_URL || !SUPABASE_ANON_KEY) return;
    const client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    let timer: ReturnType<typeof setTimeout> | null = null;
    const debounced = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(fetchStatus, 400);
    };

    const channel = client
      .channel(`run-kanban-${runId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "ForgeEvent",
          filter: `runId=eq.${runId}`,
        },
        debounced,
      )
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "ForgeRun",
          filter: `id=eq.${runId}`,
        },
        debounced,
      )
      .subscribe();

    // Fallback poll + clock pra atualizar "Xs" das stories running
    const poll = setInterval(fetchStatus, 15_000);
    const clock = setInterval(() => setTick((t) => t + 1), 5_000);

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      clearInterval(poll);
      clearInterval(clock);
      client.removeChannel(channel);
    };
  }, [runId]);

  if (prds === null) {
    return (
      <div className="rounded-lg border bg-card p-4 text-sm text-muted-foreground">
        Carregando status dos PRDs…
      </div>
    );
  }

  if (prds.length === 0) {
    return (
      <div className="rounded-lg border bg-card p-4 text-sm text-muted-foreground">
        Este run não tem PRDs no manifest.
      </div>
    );
  }

  const counts = {
    pending: prds.filter((p) => p.status === "pending").length,
    running: prds.filter((p) => p.status === "running").length,
    done: prds.filter((p) => p.status === "done").length,
    failed: prds.filter((p) => p.status === "failed").length,
  };

  return (
    <div className="rounded-lg border bg-card p-4 space-y-3">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-semibold">Pipeline do run</h3>
          {runStatus && (
            <span className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground bg-muted px-1.5 py-0.5 rounded">
              {runStatus}
            </span>
          )}
        </div>
        <div className="flex items-center gap-3 text-xs text-muted-foreground">
          <span>{counts.done}/{prds.length} prontos</span>
          {counts.running > 0 && (
            <span className="text-blue-600 dark:text-blue-400">
              {counts.running} rodando
            </span>
          )}
          {counts.failed > 0 && (
            <span className="text-rose-600 dark:text-rose-400">
              {counts.failed} falhou
            </span>
          )}
          <Link
            href={`/forge-spike/runs/${runId}`}
            className="inline-flex items-center gap-1 text-foreground hover:underline"
          >
            Stream ao vivo
            <ExternalLink className="size-3" />
          </Link>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {COLUMNS.map((col) => {
          const items = prds.filter((p) => p.status === col.key);
          const Icon = col.Icon;
          return (
            <div
              key={col.key}
              className={cn(
                "rounded-md border p-2.5 min-h-[100px]",
                col.tone,
              )}
            >
              <div className="flex items-center gap-1.5 pb-2 border-b border-current/10">
                <span
                  aria-hidden
                  className={cn("size-1.5 rounded-full", col.dotTone)}
                />
                <Icon
                  className={cn(
                    "size-3.5 shrink-0",
                    col.key === "running" && "animate-spin",
                  )}
                />
                <span className="text-xs font-semibold uppercase tracking-wider">
                  {col.label}
                </span>
                <span className="ml-auto font-mono text-[10px] tabular-nums opacity-70">
                  {items.length}
                </span>
              </div>
              <ul className="mt-2 space-y-1.5">
                {items.length === 0 && (
                  <li className="text-[11px] text-muted-foreground opacity-60 italic">
                    vazio
                  </li>
                )}
                {items.map((p) => (
                  <PrdCardItem
                    key={p.id}
                    prd={p}
                    projectId={projectId}
                    columnKey={col.key}
                  />
                ))}
              </ul>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function PrdCardItem({
  prd,
  projectId,
  columnKey,
}: {
  prd: PrdLine;
  projectId?: string;
  columnKey: PrdStatus;
}) {
  const inner = (
    <div className="rounded-sm bg-background/60 border border-current/10 px-2 py-1.5 hover:bg-background/90 transition-colors">
      <div className="flex items-center gap-1.5">
        <span className="font-mono text-[9px] tabular-nums opacity-70 shrink-0">
          {prd.reference}
        </span>
        <span className="text-[11px] truncate flex-1 min-w-0 font-medium">
          {prd.title}
        </span>
      </div>
      <div className="mt-1 flex items-center gap-2 text-[10px] opacity-70">
        {columnKey === "running" && prd.startedAt && (
          <span className="inline-flex items-center gap-1 tabular-nums">
            <Clock className="size-2.5" />
            {formatRelative(prd.startedAt)}
          </span>
        )}
        {(columnKey === "done" || columnKey === "failed") &&
          prd.durationMs !== null && (
            <span className="inline-flex items-center gap-1 tabular-nums">
              <Clock className="size-2.5" />
              {formatDuration(prd.durationMs)}
            </span>
          )}
      </div>
    </div>
  );

  if (projectId) {
    return (
      <li>
        <Link
          href={`/projects/${projectId}/forge/prds/${prd.id}`}
          className="block"
        >
          {inner}
        </Link>
      </li>
    );
  }
  return <li>{inner}</li>;
}
