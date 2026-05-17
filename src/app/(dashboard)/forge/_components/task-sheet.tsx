"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { FileText, Search, Terminal, Database } from "lucide-react";
import {
  ResponsiveSheet,
  ResponsiveSheetContent,
  ResponsiveSheetHeader,
  ResponsiveSheetTitle,
  ResponsiveSheetBody,
} from "@/components/ui/responsive-sheet";
import { PixelBar } from "@/components/ui/pixel-bar";
import {
  useForgeSlice,
  useTaskSelection,
} from "@/hooks/use-forge-store";
import type {
  AgentStatus,
  ForgeEvent,
  ForgeState,
  ForgeTask,
} from "@/lib/forge/types";

type TabKey = "mind" | "tools" | "metrics";

const STATUS_LABEL: Record<AgentStatus, string> = {
  idle: "ocioso",
  spawning: "iniciando",
  thinking: "pensando",
  tool: "ferramenta",
  streaming: "transmitindo",
  done: "concluído",
  error: "erro",
};

const STATUS_TONE: Record<AgentStatus, string> = {
  idle: "oklch(0.6 0 0)",
  spawning: "oklch(0.7 0.16 65)",
  thinking: "oklch(0.6 0.13 250)",
  tool: "oklch(0.7 0.16 65)",
  streaming: "oklch(0.6 0.13 250)",
  done: "oklch(0.74 0.18 145)",
  error: "oklch(0.637 0.237 22)",
};

const TOOL_ICON: Record<string, typeof FileText> = {
  read_file: FileText,
  grep: Search,
  sql_query: Database,
  bash: Terminal,
};

export function TaskSheet() {
  const { selectedTaskId, setSelectedTaskId } = useTaskSelection();
  const taskOrder = useForgeSlice(
    (s: ForgeState) => s.taskOrder,
    (a, b) => a === b || (a.length === b.length && a.every((v, i) => v === b[i])),
  );
  const [lastTaskId, setLastTaskId] = useState<string | null>(null);
  const taskId = selectedTaskId ?? lastTaskId;
  const open = selectedTaskId !== null;

  // Keyboard nav: j/k → next/prev task in list (only while sheet is open).
  useEffect(() => {
    if (!open || !selectedTaskId) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLElement) {
        const tag = e.target.tagName;
        if (tag === "INPUT" || tag === "TEXTAREA" || e.target.isContentEditable) return;
      }
      if (e.key !== "j" && e.key !== "k") return;
      const idx = taskOrder.indexOf(selectedTaskId);
      if (idx < 0) return;
      const delta = e.key === "j" ? 1 : -1;
      const next = taskOrder[idx + delta];
      if (next) {
        e.preventDefault();
        setSelectedTaskId(next);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, selectedTaskId, taskOrder, setSelectedTaskId]);

  return (
    <ResponsiveSheet
      open={open}
      onOpenChange={(v) => {
        if (!v) {
          if (selectedTaskId) setLastTaskId(selectedTaskId);
          setSelectedTaskId(null);
        }
      }}
    >
      <ResponsiveSheetContent size="lg" desktopSide="right">
        {taskId ? <TaskSheetBody taskId={taskId} /> : null}
      </ResponsiveSheetContent>
    </ResponsiveSheet>
  );
}

function TaskSheetBody({ taskId }: { taskId: string }) {
  const task = useForgeSlice((s: ForgeState) => s.tasks[taskId] ?? null);
  const agentId = task?.agent_id ?? null;
  const agent = useForgeSlice((s: ForgeState) =>
    agentId ? (s.agents[agentId] ?? null) : null,
  );
  const events = useForgeSlice(
    (s: ForgeState) => s.taskEvents[taskId] ?? null,
  );

  const [tab, setTab] = useState<TabKey>("mind");

  if (!task) {
    return (
      <div className="grid h-full place-items-center p-6 text-sm text-muted-foreground">
        Task não encontrada (run resetou?).
      </div>
    );
  }

  const ord = task.ord.toString().padStart(3, "0");
  const isSub = agent?.parent_id !== null;
  const agentName = agent?.name ?? "—";

  return (
    <>
      <ResponsiveSheetHeader className="gap-3 border-b">
        <div className="flex items-center gap-2">
          <span className="font-mono text-xs tabular-nums text-muted-foreground">
            #{ord}
          </span>
          <ResponsiveSheetTitle className="text-base">
            {task.title}
          </ResponsiveSheetTitle>
        </div>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
          <span className="font-mono uppercase tracking-wider">
            <span className="text-muted-foreground/70">
              {isSub ? "└ " : "▲ "}
            </span>
            {agentName}
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span
              aria-hidden
              className="inline-block size-2 rounded-[1px]"
              style={{ background: STATUS_TONE[task.status] }}
            />
            {STATUS_LABEL[task.status]}
          </span>
          <span className="font-mono tabular-nums">
            {formatTokens(task.tokens_out)} tok
          </span>
          <span className="font-mono tabular-nums">{formatCost(task.cost_usd)}</span>
          <ElapsedReadout
            startedAt={task.started_at}
            endedAt={task.ended_at}
          />
        </div>
        <TabBar tab={tab} setTab={setTab} />
      </ResponsiveSheetHeader>

      <ResponsiveSheetBody className="flex-1 min-h-0 p-0">
        {tab === "mind" ? (
          <MindTab events={events} status={task.status} />
        ) : tab === "tools" ? (
          <ToolsTab events={events} />
        ) : (
          <MetricsTab task={task} events={events} />
        )}
      </ResponsiveSheetBody>
    </>
  );
}

function TabBar({
  tab,
  setTab,
}: {
  tab: TabKey;
  setTab: (t: TabKey) => void;
}) {
  return (
    <div className="-mb-3 flex gap-1 border-b">
      {(["mind", "tools", "metrics"] as TabKey[]).map((key) => (
        <button
          key={key}
          type="button"
          onClick={() => setTab(key)}
          className={`relative px-3 py-2 text-xs font-medium uppercase tracking-wider transition-colors ${
            tab === key
              ? "text-foreground"
              : "text-muted-foreground hover:text-foreground"
          }`}
        >
          {key === "mind" ? "Mind" : key === "tools" ? "Tools" : "Metrics"}
          {tab === key && (
            <span
              aria-hidden
              className="absolute inset-x-2 -bottom-px h-px bg-foreground"
            />
          )}
        </button>
      ))}
    </div>
  );
}

function ElapsedReadout({
  startedAt,
  endedAt,
}: {
  startedAt: number | null;
  endedAt: number | null;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (!startedAt) {
      if (ref.current) ref.current.textContent = "—";
      return;
    }
    if (endedAt) {
      if (ref.current) ref.current.textContent = formatElapsedShort(endedAt - startedAt);
      return;
    }
    let raf: number;
    const tick = () => {
      if (ref.current)
        ref.current.textContent = formatElapsedShort(Date.now() - startedAt);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [startedAt, endedAt]);
  return <span ref={ref} className="font-mono tabular-nums">—</span>;
}

// ─── Mind tab ────────────────────────────────────────────────────────────────

function MindTab({
  events,
  status,
}: {
  events: ForgeEvent[] | null;
  status: AgentStatus;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const pinnedRef = useRef(true);

  const thoughts = useMemo(() => {
    if (!events) return [] as { id: number; text: string }[];
    return events
      .filter((e) => e.kind === "thought" && typeof e.payload.text === "string")
      .map((e, i) => ({ id: e.seq ?? i, text: e.payload.text as string }));
  }, [events]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el || !pinnedRef.current) return;
    el.scrollTop = el.scrollHeight;
  }, [thoughts.length]);

  const onScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const el = e.currentTarget;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 24;
    pinnedRef.current = atBottom;
  };

  const isLive = status === "thinking" || status === "streaming" || status === "tool";

  if (thoughts.length === 0) {
    return (
      <div className="grid h-full place-items-center px-6 py-8 text-center text-sm text-muted-foreground">
        Aguardando pensamentos…
      </div>
    );
  }

  return (
    <div
      ref={scrollRef}
      onScroll={onScroll}
      className="h-full overflow-y-auto px-6 py-4 font-mono text-[12px] leading-relaxed"
    >
      {thoughts.map((t, i) => {
        const isLast = i === thoughts.length - 1;
        return (
          <p
            key={t.id}
            className="mb-2 whitespace-pre-wrap text-foreground/90"
          >
            <span className="text-muted-foreground/60">▮ </span>
            {t.text}
            {isLast && isLive ? <Cursor /> : null}
          </p>
        );
      })}
    </div>
  );
}

function Cursor() {
  return (
    <span
      aria-hidden
      className="ml-1 inline-block h-[1em] w-[0.5em] translate-y-[2px] animate-pulse bg-foreground/80 motion-reduce:animate-none"
    />
  );
}

// ─── Tools tab ───────────────────────────────────────────────────────────────

type ToolEntry = {
  id: number;
  tool: string;
  description: string | null;
  startTs: number;
  endTs: number | null;
  result: Record<string, unknown> | null;
};

function ToolsTab({ events }: { events: ForgeEvent[] | null }) {
  const entries = useMemo<ToolEntry[]>(() => {
    if (!events) return [];
    const out: ToolEntry[] = [];
    const open: Record<string, ToolEntry> = {};
    for (const e of events) {
      if (e.kind === "tool_call") {
        const tool = (e.payload.tool as string) ?? "tool";
        const entry: ToolEntry = {
          id: e.seq,
          tool,
          description: (e.payload.description as string | undefined) ?? null,
          startTs: e.ts,
          endTs: null,
          result: null,
        };
        out.push(entry);
        open[tool] = entry;
      } else if (e.kind === "tool_result") {
        const tool = (e.payload.tool as string) ?? "tool";
        const entry = open[tool];
        if (entry && entry.endTs === null) {
          entry.endTs = e.ts;
          entry.result = e.payload;
          delete open[tool];
        }
      }
    }
    return out;
  }, [events]);

  if (entries.length === 0) {
    return (
      <div className="grid h-full place-items-center px-6 py-8 text-center text-sm text-muted-foreground">
        Nenhuma ferramenta chamada ainda.
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto px-6 py-4">
      <ol className="space-y-3">
        {entries.map((entry) => {
          const Icon = TOOL_ICON[entry.tool] ?? Terminal;
          const latency = entry.endTs ? entry.endTs - entry.startTs : null;
          const ok = entry.result && !("error" in entry.result);
          return (
            <li
              key={entry.id}
              className="rounded-md border border-border/60 bg-muted/20 px-3 py-2 text-sm"
            >
              <div className="flex items-center gap-2">
                <Icon className="size-3.5 text-muted-foreground" aria-hidden />
                <span className="font-mono text-xs font-medium">
                  {entry.tool}
                </span>
                {entry.endTs === null ? (
                  <span
                    aria-hidden
                    className="inline-block size-1.5 animate-pulse rounded-[1px] bg-amber-500 motion-reduce:animate-none"
                  />
                ) : null}
                <span className="ml-auto font-mono text-[11px] tabular-nums text-muted-foreground">
                  {latency !== null
                    ? `${Math.max(1, Math.round(latency))}ms`
                    : "…"}
                </span>
              </div>
              {entry.description ? (
                <div className="mt-1 truncate font-mono text-[11px] text-muted-foreground">
                  {entry.description}
                </div>
              ) : null}
              {entry.result && !ok ? (
                <div className="mt-1 font-mono text-[11px] text-destructive">
                  {(entry.result.error as string) ?? "erro"}
                </div>
              ) : null}
            </li>
          );
        })}
      </ol>
    </div>
  );
}

// ─── Metrics tab ─────────────────────────────────────────────────────────────

function MetricsTab({
  task,
  events,
}: {
  task: ForgeTask;
  events: ForgeEvent[] | null;
}) {
  const sparkRef = useRef<HTMLCanvasElement>(null);
  const samplesRef = useRef<number[]>([]);

  // Compute tokens/sec sparkline from events: 60 samples, 1s window each.
  useEffect(() => {
    if (!events) return;
    const now = Date.now();
    const samples = Array(60).fill(0);
    for (const e of events) {
      if (e.kind !== "token") continue;
      const age = (now - e.ts) / 1000; // seconds ago
      const idx = 59 - Math.floor(age);
      if (idx < 0 || idx >= 60) continue;
      samples[idx] += ((e.payload.out as number) ?? 1);
    }
    samplesRef.current = samples;
    drawSparkline(sparkRef.current, samples);
  }, [events]);

  // Run progress relative — task vs whole-run (no whole-run access here, use 100)
  const tokensInBar = Math.min(100, Math.round((task.tokens_in / 200) * 100));
  const tokensOutBar = Math.min(100, Math.round((task.tokens_out / 200) * 100));
  const costBar = Math.min(100, Math.round((task.cost_usd / 0.05) * 100));

  return (
    <div className="h-full overflow-y-auto px-6 py-4">
      <dl className="space-y-4">
        <MetricRow label="Tokens In" score={tokensInBar} readout={`${task.tokens_in}`} />
        <MetricRow label="Tokens Out" score={tokensOutBar} readout={formatTokens(task.tokens_out)} />
        <MetricRow label="Cost" score={costBar} readout={formatCost(task.cost_usd)} />
        <MetricRow label="Progress" score={task.progress} readout={`${task.progress}%`} />
      </dl>

      <div className="mt-6 space-y-1">
        <div className="flex items-center justify-between">
          <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
            Tokens/s (60s)
          </span>
        </div>
        <canvas
          ref={sparkRef}
          width={600}
          height={32}
          className="w-full"
          style={{ height: 32 }}
        />
      </div>
    </div>
  );
}

function MetricRow({
  label,
  score,
  readout,
}: {
  label: string;
  score: number;
  readout: string;
}) {
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between">
        <dt className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
          {label}
        </dt>
        <dd className="font-mono text-xs tabular-nums text-muted-foreground">
          {readout}
        </dd>
      </div>
      <PixelBar score={score} cells={20} height={6} variant="skill" glow={false} />
    </div>
  );
}

function drawSparkline(canvas: HTMLCanvasElement | null, samples: number[]) {
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const dpr = window.devicePixelRatio || 1;
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  if (canvas.width !== w * dpr || canvas.height !== h * dpr) {
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    ctx.scale(dpr, dpr);
  }
  ctx.clearRect(0, 0, w, h);
  const max = Math.max(1, ...samples);
  const barW = w / samples.length;
  ctx.fillStyle = "oklch(0.6 0.13 250 / 0.6)";
  for (let i = 0; i < samples.length; i++) {
    const v = samples[i];
    const barH = Math.max(1, (v / max) * (h - 2));
    ctx.fillRect(i * barW, h - barH, Math.max(1, barW - 1), barH);
  }
}

// ─── helpers ─────────────────────────────────────────────────────────────────

function formatTokens(n: number) {
  if (n < 1000) return `${n}`;
  return `${(n / 1000).toFixed(1)}k`;
}

function formatCost(n: number) {
  if (n < 0.01) return "$0.00";
  return `$${n.toFixed(3)}`;
}

function formatElapsedShort(ms: number) {
  const s = Math.max(0, Math.floor(ms / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}m ${r}s`;
}
