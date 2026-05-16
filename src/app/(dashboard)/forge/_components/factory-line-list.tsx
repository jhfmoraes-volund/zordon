"use client";

import { useEffect, useRef } from "react";
import { Card } from "@/components/ui/card";
import { useForge, useForgeSlice } from "@/hooks/use-forge-store";
import type { AgentStatus, ForgeState, ForgeTask } from "@/lib/forge/types";

const GRID_COLS =
  "24px 48px 160px minmax(220px, 1fr) 120px 180px 64px 76px 56px";

const selectAgents = (s: ForgeState) => s.agents;
const selectTaskOrder = (s: ForgeState) => s.taskOrder;

function taskOrderEqual(a: string[], b: string[]) {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

/**
 * FactoryLineList — linha de produção da FORGE.
 * Cada row = forge_task. Click → TaskSheet (Fase 5).
 * Lista reage no React; campos voláteis (progress/tokens/cost/tool/status)
 * são reescritos por raf via refs (lei L1/L2).
 */
export function FactoryLineList() {
  const taskOrder = useForgeSlice(selectTaskOrder, taskOrderEqual);
  const agents = useForgeSlice(selectAgents);

  return (
    <Card className="overflow-hidden">
      <FactoryLineHeader />
      {taskOrder.length === 0 ? (
        <FactoryLineEmpty />
      ) : (
        <div className="divide-y divide-border/60">
          {taskOrder.map((id) => (
            <FactoryLineRow key={id} taskId={id} agents={agents} />
          ))}
        </div>
      )}
    </Card>
  );
}

function FactoryLineHeader() {
  return (
    <div
      className="grid gap-3 border-b bg-muted/30 px-3 py-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground"
      style={{ gridTemplateColumns: GRID_COLS }}
    >
      <span aria-hidden />
      <span>#</span>
      <span>Agent</span>
      <span>Task</span>
      <span>Tool</span>
      <span>Progress</span>
      <span className="text-right">Tokens</span>
      <span className="text-right">Cost</span>
      <span className="text-right">Time</span>
    </div>
  );
}

function FactoryLineEmpty() {
  return (
    <div className="grid min-h-[280px] place-items-center p-8 text-center">
      <div className="space-y-2">
        <p className="text-sm text-muted-foreground">Nenhuma task em execução</p>
        <p className="text-xs text-muted-foreground/70">
          Aperte <kbd className="rounded border border-border/60 bg-muted/40 px-1 py-px font-mono text-[10px]">Start</kbd>{" "}
          para iniciar um run mockado.
        </p>
      </div>
    </div>
  );
}

const STATUS_TONE: Record<AgentStatus, string> = {
  idle: "oklch(0.6 0 0)",
  spawning: "oklch(0.7 0.16 65)",
  thinking: "oklch(0.6 0.13 250)",
  tool: "oklch(0.7 0.16 65)",
  streaming: "oklch(0.6 0.13 250)",
  done: "oklch(0.74 0.18 145)",
  error: "oklch(0.637 0.237 22)",
};

const STATUS_PULSE: Record<AgentStatus, boolean> = {
  idle: false,
  spawning: true,
  thinking: true,
  tool: false,
  streaming: true,
  done: false,
  error: false,
};

function formatTokens(n: number) {
  if (n < 1000) return `${n}`;
  return `${(n / 1000).toFixed(1)}k`;
}

function formatCost(n: number) {
  if (n < 0.01) return `$0.00`;
  return `$${n.toFixed(3)}`;
}

function formatElapsed(ms: number) {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${s}s`;
}

function FactoryLineRow({
  taskId,
  agents,
}: {
  taskId: string;
  agents: ForgeState["agents"];
}) {
  const { store } = useForge();
  const rowRef = useRef<HTMLDivElement>(null);
  const dotRef = useRef<HTMLSpanElement>(null);
  const toolRef = useRef<HTMLSpanElement>(null);
  const progressFillRef = useRef<HTMLDivElement>(null);
  const progressTextRef = useRef<HTMLSpanElement>(null);
  const tokensRef = useRef<HTMLSpanElement>(null);
  const costRef = useRef<HTMLSpanElement>(null);
  const timeRef = useRef<HTMLSpanElement>(null);

  // initial snapshot for static fields (ord, agent name, title)
  const initial = store.getState().tasks[taskId];

  useEffect(() => {
    let raf: number;
    let lastStatus: AgentStatus | null = null;

    const tick = () => {
      const t: ForgeTask | undefined = store.getState().tasks[taskId];
      if (t) {
        if (t.status !== lastStatus) {
          if (dotRef.current) {
            const tone = STATUS_TONE[t.status];
            dotRef.current.style.background = tone;
            dotRef.current.style.boxShadow = `0 0 6px ${tone}`;
            dotRef.current.dataset.pulse = STATUS_PULSE[t.status] ? "1" : "0";
          }
          if (rowRef.current) {
            rowRef.current.dataset.status = t.status;
          }
          lastStatus = t.status;
        }
        if (toolRef.current) {
          toolRef.current.textContent = t.current_tool ?? "—";
        }
        if (progressFillRef.current) {
          progressFillRef.current.style.width = `${t.progress}%`;
        }
        if (progressTextRef.current) {
          progressTextRef.current.textContent = `${t.progress}%`;
        }
        if (tokensRef.current) {
          tokensRef.current.textContent = formatTokens(t.tokens_out);
        }
        if (costRef.current) {
          costRef.current.textContent = formatCost(t.cost_usd);
        }
        if (timeRef.current && t.started_at) {
          const end = t.ended_at ?? Date.now();
          timeRef.current.textContent = formatElapsed(end - t.started_at);
        }
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [store, taskId]);

  if (!initial) return null;
  const agent = agents[initial.agent_id];
  const isSub = agent?.parent_id !== null;
  const ord = initial.ord.toString().padStart(3, "0");

  return (
    <div
      ref={rowRef}
      role="button"
      tabIndex={0}
      data-status={initial.status}
      className="grid items-center gap-3 px-3 py-2 text-sm transition-colors hover:bg-muted/40 data-[status=done]:opacity-70 data-[status=error]:border-l-2 data-[status=error]:border-destructive/50"
      style={{ gridTemplateColumns: GRID_COLS }}
    >
      <span
        ref={dotRef}
        aria-hidden
        className="inline-block size-2 rounded-[1px] data-[pulse=1]:animate-pulse motion-reduce:animate-none"
        style={{ background: STATUS_TONE[initial.status] }}
      />
      <span className="font-mono text-xs tabular-nums text-muted-foreground">
        #{ord}
      </span>
      <span className="truncate font-mono text-xs uppercase tracking-wider">
        <span className="text-muted-foreground">{isSub ? "└ " : "▲ "}</span>
        {agent?.name ?? "—"}
      </span>
      <span className="truncate text-foreground/90">{initial.title}</span>
      <span ref={toolRef} className="truncate font-mono text-xs text-muted-foreground">
        —
      </span>
      <RowProgressCell fillRef={progressFillRef} textRef={progressTextRef} />
      <span ref={tokensRef} className="text-right font-mono text-xs tabular-nums text-muted-foreground">
        0
      </span>
      <span ref={costRef} className="text-right font-mono text-xs tabular-nums text-muted-foreground">
        $0.00
      </span>
      <span ref={timeRef} className="text-right font-mono text-xs tabular-nums text-muted-foreground">
        0s
      </span>
    </div>
  );
}

function RowProgressCell({
  fillRef,
  textRef,
}: {
  fillRef: React.RefObject<HTMLDivElement | null>;
  textRef: React.RefObject<HTMLSpanElement | null>;
}) {
  return (
    <div className="flex items-center gap-2">
      <div
        className="relative h-1.5 flex-1 overflow-hidden rounded-[2px]"
        style={{ background: "oklch(0.1 0 0)", boxShadow: "inset 0 0 0 1px oklch(1 0 0 / 0.06)" }}
      >
        <div
          ref={fillRef}
          className="h-full"
          style={{
            width: "0%",
            background: "oklch(0.6 0.13 250)",
            transition: "width 120ms linear",
          }}
        />
      </div>
      <span ref={textRef} className="w-9 text-right font-mono text-[11px] tabular-nums text-muted-foreground">
        0%
      </span>
    </div>
  );
}
