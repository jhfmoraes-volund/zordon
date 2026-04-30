"use client";

import { PixelBar, pixelTone, PixelHud } from "@/components/ui/pixel-bar";

/**
 * Battery-style visualization of a member's FP commitment, using
 * the same arcade-retro pixel bar from skills/load widgets.
 *
 * capacity   = Member.fpCapacity (sprint-level total)
 * committed  = SUM(ProjectMember.fpAllocation) — already promised across projects
 * breakdown  = optional per-project segments (label, value) — rendered as
 *              colored chips below the bar; we don't try to segment the
 *              pixel bar itself (it would lose the retro feel).
 */
export type BatterySegment = {
  label: string;
  value: number;
};

export function MemberBattery({
  capacity,
  committed,
  done,
  breakdown,
  size = "md",
  showNumbers = true,
}: {
  capacity: number;
  committed: number;
  /** Quanto do committed já foi entregue (▓ done dentro da bateria). */
  done?: number;
  breakdown?: BatterySegment[];
  size?: "sm" | "md";
  showNumbers?: boolean;
}) {
  const safeCapacity = Math.max(capacity, 1);
  const overcommit = committed > capacity;
  const usagePct = (committed / safeCapacity) * 100;
  const donePct = done !== undefined ? (Math.min(done, committed) / safeCapacity) * 100 : 0;
  const tone = pixelTone(usagePct, "load");

  const cells = size === "sm" ? 16 : 24;
  const height = size === "sm" ? 10 : 14;
  const showStacked = done !== undefined && done > 0 && committed > 0;

  return (
    <div className="w-full space-y-1.5">
      {showStacked ? (
        <div className="relative">
          {/* Camada 1: barra clara representando o committed total */}
          <PixelBar score={usagePct} cells={cells} height={height} variant="load" />
          {/* Camada 2: barra sólida representando done dentro do committed */}
          <div className="absolute inset-0 pointer-events-none" style={{ width: `${Math.min(donePct, 100)}%` }}>
            <PixelBar score={100} cells={Math.max(1, Math.round(cells * (Math.min(donePct, 100) / 100)))} height={height} variant="skill" />
          </div>
        </div>
      ) : (
        <PixelBar score={usagePct} cells={cells} height={height} variant="load" />
      )}

      {showNumbers && (
        <div className="flex items-center justify-between leading-none">
          <span className="flex items-baseline gap-1">
            <span
              className="font-mono text-base tabular-nums leading-none"
              style={{ color: tone.fg }}
            >
              {committed}
            </span>
            <span className="font-mono text-sm tabular-nums leading-none text-muted-foreground">
              / {capacity}
            </span>
            <PixelHud size="xs" tone="muted" className="ml-1">FP</PixelHud>
          </span>
          {overcommit ? (
            <PixelHud size="xs" style={{ color: "oklch(0.82 0.2 22)" }}>
              +{committed - capacity} overcommit
            </PixelHud>
          ) : committed === capacity ? (
            <PixelHud size="xs" style={{ color: "oklch(0.82 0.15 65)" }}>
              bateria cheia
            </PixelHud>
          ) : (
            <PixelHud size="xs" tone="muted">
              {capacity - committed} livre
            </PixelHud>
          )}
        </div>
      )}

      {breakdown && breakdown.length > 0 && (
        <div className="flex flex-wrap gap-1.5 pt-1">
          {breakdown.map((seg, i) => (
            <span
              key={`${seg.label}-${i}`}
              className="inline-flex items-center gap-1.5 rounded-full px-2 py-0.5"
              style={{
                background: "oklch(1 0 0 / 0.06)",
                boxShadow: "inset 0 0 0 1px oklch(1 0 0 / 0.08)",
              }}
            >
              <PixelHud size="xs" tone="muted">{seg.label}</PixelHud>
              <span className="font-mono text-sm tabular-nums leading-none text-foreground">
                {seg.value}
              </span>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
