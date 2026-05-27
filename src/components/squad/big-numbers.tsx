"use client";

/**
 * Squad "Big Numbers" — the standard KPI strip shown on every squad lounge.
 * Speaks the arcade pixel-HUD language (segmented bar + uppercase labels) so it
 * sits alongside the sprint/member widgets rather than reading like a generic
 * SaaS dashboard. Reusable: today it's only mounted on the lounge.
 */

import { PixelBar, PixelHud, PixelDot, pixelTone } from "@/components/ui/pixel-bar";

export type SquadMetrics = {
  projectCount: number;
  activeSprintCount: number;
  taskOpen: number;
  taskTotal: number;
  fpDone: number;
  fpTotal: number;
  fpAllocated: number;
  fpCapacity: number;
};

function Stat({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-md border bg-background/40 p-3">
      <PixelHud size="xs" tone="muted" className="block">
        {label}
      </PixelHud>
      <div className="mt-1.5">{children}</div>
    </div>
  );
}

export function SquadBigNumbers({ metrics }: { metrics: SquadMetrics }) {
  const fpDonePct =
    metrics.fpTotal > 0 ? (metrics.fpDone / metrics.fpTotal) * 100 : 0;
  // Load: allocated vs capacity. Higher is "fuller" (warns near/over 100%).
  const loadPct =
    metrics.fpCapacity > 0
      ? (metrics.fpAllocated / metrics.fpCapacity) * 100
      : 0;
  const loadTone = pixelTone(loadPct, "load");

  return (
    <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
      <Stat label="Projetos">
        <p className="text-2xl font-bold leading-none tabular-nums">
          {metrics.projectCount}
        </p>
        <p className="mt-1 text-[10px] text-muted-foreground tabular-nums">
          {metrics.activeSprintCount} sprint{metrics.activeSprintCount === 1 ? "" : "s"} ativo
          {metrics.activeSprintCount === 1 ? "" : "s"}
        </p>
      </Stat>

      <Stat label="Tasks">
        <p className="text-2xl font-bold leading-none tabular-nums">
          {metrics.taskOpen}
          <span className="text-sm font-medium text-muted-foreground">
            {" "}
            / {metrics.taskTotal}
          </span>
        </p>
        <p className="mt-1 inline-flex items-center gap-1 text-[10px] text-muted-foreground">
          <PixelDot variant="open" size={6} /> em aberto
        </p>
      </Stat>

      <Stat label="Function Points">
        <p className="text-2xl font-bold leading-none tabular-nums">
          {metrics.fpDone}
          <span className="text-sm font-medium text-muted-foreground">
            {" "}
            / {metrics.fpTotal}
          </span>
        </p>
        <div className="mt-1.5">
          <PixelBar score={fpDonePct} cells={16} height={7} variant="skill" />
        </div>
      </Stat>

      <Stat label="Capacidade">
        <p
          className="text-2xl font-bold leading-none tabular-nums"
          style={{ color: metrics.fpCapacity > 0 ? loadTone.fg : undefined }}
        >
          {Math.round(loadPct)}
          <span className="text-sm font-medium">%</span>
        </p>
        <div className="mt-1.5">
          <PixelBar
            score={Math.min(loadPct, 100)}
            cells={16}
            height={7}
            variant="load"
          />
        </div>
        <p className="mt-1 text-[10px] text-muted-foreground tabular-nums">
          {metrics.fpAllocated} / {metrics.fpCapacity} FP·sem
        </p>
      </Stat>
    </div>
  );
}
