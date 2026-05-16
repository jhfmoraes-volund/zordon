"use client";

import { useEffect, useRef } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { PixelBar } from "@/components/ui/pixel-bar";
import { useForgeSlice } from "@/hooks/use-forge-store";
import type { ForgeState } from "@/lib/forge/types";

const selectHud = (s: ForgeState) => ({
  runId: s.run?.id ?? null,
  status: s.run?.status ?? null,
  progress: s.run?.progress ?? null,
  startedAt: s.run?.started_at ?? null,
  endedAt: s.run?.ended_at ?? null,
  tokens: s.run?.tokens_total ?? 0,
  cost: s.run?.cost_total ?? 0,
});

function hudEqual(a: ReturnType<typeof selectHud>, b: ReturnType<typeof selectHud>) {
  return (
    a.runId === b.runId &&
    a.status === b.status &&
    a.progress === b.progress &&
    a.startedAt === b.startedAt &&
    a.endedAt === b.endedAt &&
    a.tokens === b.tokens &&
    a.cost === b.cost
  );
}

function formatTokens(n: number) {
  if (n < 1000) return `${n}`;
  return `${(n / 1000).toFixed(1)}k`;
}

function formatCost(n: number) {
  if (n < 0.01) return `$0.00`;
  return `$${n.toFixed(3)}`;
}

function formatElapsed(ms: number) {
  const total = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
}

function formatRunLabel(runId: string | null, status: string | null) {
  if (!runId) return "——";
  const short = runId.slice(-3).toUpperCase();
  return status === "running" ? `${short} ●` : short;
}

export function ForgeHud() {
  const hud = useForgeSlice(selectHud, hudEqual);
  const timeRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (!hud.startedAt) {
      if (timeRef.current) timeRef.current.textContent = "00:00";
      return;
    }
    if (hud.endedAt) {
      if (timeRef.current)
        timeRef.current.textContent = formatElapsed(hud.endedAt - hud.startedAt);
      return;
    }
    let raf: number;
    const startedAt = hud.startedAt;
    const update = () => {
      if (timeRef.current) timeRef.current.textContent = formatElapsed(Date.now() - startedAt);
      raf = requestAnimationFrame(update);
    };
    raf = requestAnimationFrame(update);
    return () => cancelAnimationFrame(raf);
  }, [hud.startedAt, hud.endedAt]);

  const score = hud.runId ? hud.progress ?? 0 : null;

  return (
    <Card>
      <CardContent className="grid gap-4 sm:grid-cols-[1fr_auto] sm:items-center sm:gap-8">
        <div className="space-y-2">
          <div className="flex items-center justify-between gap-3">
            <span className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
              Run progress
            </span>
            <span className="font-mono text-xs tabular-nums text-muted-foreground">
              {hud.progress ?? 0} / 100
            </span>
          </div>
          <PixelBar score={score} cells={24} height={8} variant="skill" glow={false} />
        </div>

        <dl className="grid grid-cols-4 gap-x-6 gap-y-1">
          <Readout label="Run" value={formatRunLabel(hud.runId, hud.status)} />
          <Readout label="Time" valueRef={timeRef} initial="00:00" />
          <Readout label="Tokens" value={formatTokens(hud.tokens)} />
          <Readout label="Cost" value={formatCost(hud.cost)} />
        </dl>
      </CardContent>
    </Card>
  );
}

function Readout({
  label,
  value,
  valueRef,
  initial,
}: {
  label: string;
  value?: string;
  valueRef?: React.RefObject<HTMLSpanElement | null>;
  initial?: string;
}) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
        {label}
      </dt>
      <dd className="font-mono text-sm tabular-nums">
        <span ref={valueRef}>{value ?? initial ?? ""}</span>
      </dd>
    </div>
  );
}
