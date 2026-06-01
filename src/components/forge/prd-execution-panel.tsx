"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  CheckCircle2,
  Circle,
  Clock,
  ExternalLink,
  Loader2,
  XCircle,
} from "lucide-react";
import { cn } from "@/lib/utils";

type EventItem = {
  seq: number;
  kind: string;
  ts: string;
  payload: Record<string, unknown> | null;
};

type RunSummary = {
  id: string;
  status: string;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  durationMs: number | null;
};

type AcceptanceCriterion =
  | string
  | {
      text?: string;
      given?: string;
      when?: string;
      then?: string;
    };

type ExecutionResponse = {
  prd: {
    id: string;
    reference: string;
    title: string;
    status: string;
    acceptanceCriteria: AcceptanceCriterion[];
  };
  activeRun: RunSummary | null;
  lastFinishedRun: RunSummary | null;
  focusRunId: string | null;
  history: RunSummary[];
  events: EventItem[];
};

const KIND_COLOR: Record<string, string> = {
  story_picked: "text-indigo-600 dark:text-indigo-400",
  story_done: "text-emerald-600 dark:text-emerald-400",
  story_failed: "text-rose-600 dark:text-rose-400",
  assistant_text: "text-cyan-600 dark:text-cyan-400",
  tool_use: "text-amber-600 dark:text-amber-400",
  tool_result: "text-emerald-600 dark:text-emerald-400",
  error: "text-rose-600 dark:text-rose-400",
  claude_result: "text-cyan-600 dark:text-cyan-400",
  claude_closed: "text-muted-foreground",
  raw_stdout: "text-muted-foreground",
  stderr: "text-rose-600 dark:text-rose-400",
};

function summarize(ev: EventItem): string {
  const p = ev.payload ?? {};
  if (ev.kind === "tool_use") {
    const tool = (p.tool ?? p.name ?? "?") as string;
    const input = (p.inputSummary ?? "") as string;
    return `${tool}${input ? `: ${input}` : ""}`;
  }
  if (ev.kind === "tool_result") {
    if ((p as { isError?: unknown }).isError) {
      return `error: ${String((p as { preview?: unknown }).preview ?? "").slice(0, 160)}`;
    }
    return String((p as { preview?: unknown }).preview ?? "").slice(0, 160);
  }
  if (ev.kind === "assistant_text") {
    return String((p as { text?: unknown }).text ?? "").slice(0, 240);
  }
  if (ev.kind === "story_picked") {
    return `picked ${String((p as { storyId?: unknown }).storyId ?? "")}`;
  }
  if (ev.kind === "story_done") {
    return (p as { ok?: unknown }).ok ? "✓ done" : "✗ failed";
  }
  if (ev.kind === "story_failed") return "✗ failed";
  if (ev.kind === "error") {
    return String((p as { message?: unknown }).message ?? "");
  }
  return "";
}

function fmtTime(iso: string): string {
  try {
    const d = new Date(iso);
    return `${d.getHours().toString().padStart(2, "0")}:${d.getMinutes().toString().padStart(2, "0")}:${d.getSeconds().toString().padStart(2, "0")}`;
  } catch {
    return "";
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

function acText(ac: AcceptanceCriterion): string {
  if (typeof ac === "string") return ac;
  if (ac.text) return ac.text;
  const parts: string[] = [];
  if (ac.given) parts.push(`Dado ${ac.given}`);
  if (ac.when) parts.push(`quando ${ac.when}`);
  if (ac.then) parts.push(`então ${ac.then}`);
  return parts.length > 0 ? parts.join(", ") : JSON.stringify(ac);
}

export function PrdExecutionPanel({
  projectId,
  prdId,
  backHref,
}: {
  projectId: string;
  prdId: string;
  /** Se passado, vira ?back=<backHref> no link pro run viewer pra preservar contexto. */
  backHref?: string;
}) {
  const runHref = (runId: string) =>
    backHref
      ? `/projects/${projectId}/forge/runs/${runId}?back=${encodeURIComponent(backHref)}`
      : `/projects/${projectId}/forge/runs/${runId}`;
  const [data, setData] = useState<ExecutionResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [autoScroll, setAutoScroll] = useState(true);
  const [now, setNow] = useState<number | null>(null);
  const [dispatching, setDispatching] = useState(false);
  const [dispatchError, setDispatchError] = useState<string | null>(null);
  const streamRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const r = await fetch(
          `/api/forge/projects/${projectId}/prds/${prdId}/execution`,
          { cache: "no-store" },
        );
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const json = (await r.json()) as ExecutionResponse;
        if (!alive) return;
        setData(json);
        setError(null);
      } catch (err) {
        if (alive) setError(String(err));
      }
    };
    load();
    return () => {
      alive = false;
    };
  }, [projectId, prdId]);

  // Polling rápido quando há run ativo, lento quando idle (simula live stream).
  const hasActiveRun = !!data?.activeRun;
  useEffect(() => {
    if (!hasActiveRun && data) return;
    let alive = true;
    const interval = hasActiveRun ? 1500 : 8000;
    const id = setInterval(async () => {
      try {
        const r = await fetch(
          `/api/forge/projects/${projectId}/prds/${prdId}/execution`,
          { cache: "no-store" },
        );
        if (!r.ok) return;
        const json = (await r.json()) as ExecutionResponse;
        if (alive) setData(json);
      } catch {
        // silent
      }
    }, interval);
    return () => {
      alive = false;
      clearInterval(id);
    };
    // `data` deliberately omitted — só usamos pra trigger inicial via hasActiveRun.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, prdId, hasActiveRun]);

  // Clock para atualizar elapsed. setInterval tick é async, então setNow
  // não dispara setState síncrono dentro do effect.
  useEffect(() => {
    if (!hasActiveRun) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [hasActiveRun]);

  // Auto-scroll do stream pra baixo quando novos eventos chegam.
  useEffect(() => {
    if (autoScroll && streamRef.current) {
      streamRef.current.scrollTop = streamRef.current.scrollHeight;
    }
  }, [data?.events.length, autoScroll]);

  if (error && !data) {
    return (
      <div className="rounded-lg border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive">
        {error}
      </div>
    );
  }

  if (!data) {
    return (
      <div className="rounded-lg border bg-card p-4 text-sm text-muted-foreground">
        Carregando execução…
      </div>
    );
  }

  const acList = Array.isArray(data.prd.acceptanceCriteria)
    ? data.prd.acceptanceCriteria
    : [];
  const liveDurationMs =
    data.activeRun?.startedAt && !data.activeRun.finishedAt && now !== null
      ? now - new Date(data.activeRun.startedAt).getTime()
      : null;

  return (
    <div className="space-y-4">
      {/* Banner do run mais relevante */}
      {data.activeRun ? (
        <RunBanner
          tone="amber"
          icon={<Loader2 className="size-4 animate-spin" />}
          label="Em execução"
          runId={data.activeRun.id}
          runHref={runHref(data.activeRun.id)}
          metaText={
            data.activeRun.status === "queued"
              ? "Aguardando daemon claim"
              : `Rodando · ${fmtDuration(liveDurationMs ?? data.activeRun.durationMs)}`
          }
        />
      ) : data.lastFinishedRun ? (
        <RunBanner
          tone={
            data.lastFinishedRun.status === "done"
              ? "green"
              : data.lastFinishedRun.status === "error"
                ? "red"
                : "slate"
          }
          icon={
            data.lastFinishedRun.status === "done" ? (
              <CheckCircle2 className="size-4" />
            ) : data.lastFinishedRun.status === "error" ? (
              <XCircle className="size-4" />
            ) : (
              <Circle className="size-4" />
            )
          }
          runHref={runHref(data.lastFinishedRun.id)}
          label={
            data.lastFinishedRun.status === "done"
              ? "Último run: concluído"
              : data.lastFinishedRun.status === "error"
                ? "Último run: falhou"
                : `Último run: ${data.lastFinishedRun.status}`
          }
          runId={data.lastFinishedRun.id}
          metaText={`${fmtDuration(data.lastFinishedRun.durationMs)} · ${data.history.length} run${data.history.length === 1 ? "" : "s"} no total`}
          actions={
            <>
              {dispatchError && (
                <span className="text-xs text-rose-600 mr-1">
                  ✗ {dispatchError}
                </span>
              )}
              <button
                type="button"
                disabled={dispatching}
                onClick={async () => {
                  setDispatching(true);
                  setDispatchError(null);
                  try {
                    const res = await fetch(
                      `/api/forge/projects/${projectId}/runs`,
                      {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ prdRefs: [data.prd.reference] }),
                      },
                    );
                    if (!res.ok) {
                      const j = await res.json().catch(() => ({}));
                      throw new Error(j.error ?? `HTTP ${res.status}`);
                    }
                  } catch (e) {
                    setDispatchError(e instanceof Error ? e.message : String(e));
                  } finally {
                    setDispatching(false);
                  }
                }}
                className="inline-flex items-center gap-1.5 rounded-md bg-foreground px-2.5 py-1 text-[11px] font-semibold text-background hover:opacity-80 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {dispatching ? (
                  <>
                    <Loader2 className="size-3 animate-spin" /> Disparando…
                  </>
                ) : data.lastFinishedRun.status === "error" ? (
                  <>↻ Retry</>
                ) : (
                  <>▶ Re-rodar</>
                )}
              </button>
            </>
          }
        />
      ) : (
        <div className="rounded-lg border border-dashed bg-muted/20 p-4 flex items-center justify-between gap-3 flex-wrap">
          <span className="text-sm text-muted-foreground">
            Este PRD ainda não foi executado pela Forja.
          </span>
          <button
            type="button"
            disabled={dispatching}
            onClick={async () => {
              setDispatching(true);
              setDispatchError(null);
              try {
                const res = await fetch(
                  `/api/forge/projects/${projectId}/runs`,
                  {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ prdRefs: [data.prd.reference] }),
                  },
                );
                if (!res.ok) {
                  const j = await res.json().catch(() => ({}));
                  throw new Error(j.error ?? `HTTP ${res.status}`);
                }
                // refetch acontece via SWR automaticamente quando novo run aparece
              } catch (e) {
                setDispatchError(e instanceof Error ? e.message : String(e));
              } finally {
                setDispatching(false);
              }
            }}
            className="inline-flex items-center gap-2 rounded-md bg-foreground px-3 py-1.5 text-xs font-semibold text-background hover:opacity-80 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {dispatching ? (
              <>
                <Loader2 className="size-3.5 animate-spin" /> Disparando…
              </>
            ) : (
              <>▶ Disparar Forja</>
            )}
          </button>
          {dispatchError && (
            <span className="text-xs text-rose-600 w-full">
              ✗ {dispatchError}
            </span>
          )}
        </div>
      )}

      {/* AC checklist — marca tudo ✓ quando ultimo run passou (PRD-grain hoje) */}
      {acList.length > 0 && (
        <div className="rounded-lg border bg-card p-4">
          <div className="mb-2 flex items-center justify-between">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Acceptance Criteria · {acList.length}
            </h3>
            <span className="text-[10px] text-muted-foreground/70 italic">
              {data.lastFinishedRun?.status === "done"
                ? "todos AC cobertos pelo último run ✓"
                : "checklist estático — sem verificador por AC"}
            </span>
          </div>
          <ul className="space-y-1.5">
            {acList.map((ac, i) => {
              const passed = data.lastFinishedRun?.status === "done";
              return (
                <li key={i} className="flex items-start gap-2 text-sm">
                  {passed ? (
                    <CheckCircle2 className="size-3.5 shrink-0 text-emerald-600 dark:text-emerald-400 mt-0.5" />
                  ) : (
                    <Circle className="size-3.5 shrink-0 text-muted-foreground/60 mt-0.5" />
                  )}
                  <span className={cn("flex-1", passed && "text-muted-foreground line-through decoration-muted-foreground/40")}>
                    {acText(ac)}
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {/* Live event stream */}
      <div className="rounded-lg border bg-card overflow-hidden">
        <div className="flex items-center justify-between gap-2 border-b bg-muted/20 px-4 py-2">
          <div className="flex items-center gap-2">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Stream do servidor
            </h3>
            {data.activeRun && (
              <span className="relative flex size-2">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-amber-500 opacity-75" />
                <span className="relative inline-flex size-2 rounded-full bg-amber-500" />
              </span>
            )}
            <span className="text-[10px] tabular-nums text-muted-foreground">
              {data.events.length} eventos
            </span>
          </div>
          <div className="flex items-center gap-3 text-xs">
            <label className="inline-flex items-center gap-1 text-muted-foreground cursor-pointer">
              <input
                type="checkbox"
                checked={autoScroll}
                onChange={(e) => setAutoScroll(e.target.checked)}
                className="size-3"
              />
              auto-scroll
            </label>
            {data.focusRunId && (
              <Link
                href={runHref(data.focusRunId)}
                target="_blank"
                className="inline-flex items-center gap-1 text-blue-600 hover:underline dark:text-blue-400"
              >
                <ExternalLink className="size-3" />
                stream cru
              </Link>
            )}
          </div>
        </div>
        <div
          ref={streamRef}
          className="max-h-[480px] overflow-y-auto bg-background/40 px-4 py-2 font-mono text-[11px] leading-relaxed"
        >
          {data.events.length === 0 ? (
            <div className="py-6 text-center text-muted-foreground italic">
              {data.activeRun
                ? "Aguardando primeiros eventos…"
                : "Sem eventos pra este PRD."}
            </div>
          ) : (
            data.events.map((ev) => (
              <div
                key={ev.seq}
                className="flex items-start gap-2 py-0.5 border-b border-border/30 last:border-b-0"
              >
                <span className="shrink-0 text-muted-foreground/60 tabular-nums">
                  #{ev.seq.toString().padStart(3, "0")}
                </span>
                <span className="shrink-0 text-muted-foreground/70 tabular-nums">
                  {fmtTime(ev.ts)}
                </span>
                <span
                  className={cn(
                    "shrink-0 font-semibold",
                    KIND_COLOR[ev.kind] ?? "text-muted-foreground",
                  )}
                >
                  {ev.kind}
                </span>
                <span className="break-all text-foreground/80">
                  {summarize(ev)}
                </span>
              </div>
            ))
          )}
        </div>
      </div>

      {/* History de runs */}
      {data.history.length > 1 && (
        <div className="rounded-lg border bg-card p-4">
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Histórico · {data.history.length} runs
          </h3>
          <div className="space-y-1.5">
            {data.history.map((r) => (
              <Link
                key={r.id}
                href={runHref(r.id)}
                target="_blank"
                className="flex items-center gap-3 rounded-md border p-2 text-sm hover:bg-accent/40 transition-colors"
              >
                <span
                  className={cn(
                    "shrink-0 inline-flex size-1.5 rounded-full",
                    r.status === "done" && "bg-emerald-500",
                    r.status === "error" && "bg-rose-500",
                    r.status === "running" && "bg-amber-500 animate-pulse",
                    r.status === "queued" && "bg-blue-500",
                    r.status === "aborted" && "bg-muted-foreground",
                  )}
                />
                <span className="font-mono text-[10px] text-muted-foreground">
                  {r.id.slice(0, 8)}
                </span>
                <span className="text-xs">{r.status}</span>
                <span className="ml-auto inline-flex items-center gap-1 text-[10px] text-muted-foreground tabular-nums">
                  <Clock className="size-2.5" />
                  {fmtDuration(r.durationMs)}
                </span>
                <ExternalLink className="size-3 text-muted-foreground" />
              </Link>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function RunBanner({
  tone,
  icon,
  label,
  runId,
  metaText,
  runHref,
  actions,
}: {
  tone: "amber" | "green" | "red" | "slate";
  icon: React.ReactNode;
  label: string;
  runId: string;
  metaText: string;
  runHref: string;
  actions?: React.ReactNode;
}) {
  const TONE = {
    amber: {
      bg: "bg-amber-50/40 dark:bg-amber-950/30",
      border: "border-amber-300/60 dark:border-amber-900/60",
      text: "text-amber-900 dark:text-amber-200",
      meta: "text-amber-700/80 dark:text-amber-300/70",
    },
    green: {
      bg: "bg-emerald-50/40 dark:bg-emerald-950/30",
      border: "border-emerald-300/60 dark:border-emerald-900/60",
      text: "text-emerald-900 dark:text-emerald-200",
      meta: "text-emerald-700/80 dark:text-emerald-300/70",
    },
    red: {
      bg: "bg-rose-50/40 dark:bg-rose-950/30",
      border: "border-rose-300/60 dark:border-rose-900/60",
      text: "text-rose-900 dark:text-rose-200",
      meta: "text-rose-700/80 dark:text-rose-300/70",
    },
    slate: {
      bg: "bg-muted/30",
      border: "border-muted-foreground/20",
      text: "text-foreground",
      meta: "text-muted-foreground",
    },
  }[tone];

  return (
    <div
      className={cn(
        "flex items-center gap-3 rounded-lg border px-4 py-3 flex-wrap",
        TONE.bg,
        TONE.border,
      )}
    >
      <span className={cn("shrink-0", TONE.text)}>{icon}</span>
      <div className="flex flex-col min-w-0">
        <span className={cn("text-sm font-semibold", TONE.text)}>{label}</span>
        <span className={cn("text-xs tabular-nums", TONE.meta)}>
          {metaText} · #{runId.slice(0, 8)}
        </span>
      </div>
      <div className="ml-auto flex items-center gap-3">
        {actions}
        <Link
          href={runHref}
          target="_blank"
          className={cn(
            "inline-flex items-center gap-1 text-xs font-semibold hover:underline",
            TONE.text,
          )}
        >
          <ExternalLink className="size-3" />
          ver run
        </Link>
      </div>
    </div>
  );
}
