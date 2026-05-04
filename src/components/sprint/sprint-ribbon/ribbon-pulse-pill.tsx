"use client";

import { PixelBar, PixelHud } from "@/components/ui/pixel-bar";

type Props = {
  workPct: number;
  timePct: number;
  /** Δ (work − time) in pp. Positive = ahead, negative = behind. */
  deltaPp: number;
  active: boolean;
  onToggle: () => void;
};

/**
 * Pulse compacto — apenas a mini PixelBar de Work (Tempo e Δ ficam no drawer "vitais").
 */
export function RibbonPulsePill({
  workPct,
  active,
  onToggle,
}: Props) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={active}
      aria-controls="sprint-ribbon-drawer"
      className={[
        "inline-flex shrink-0 items-center gap-1.5 rounded-md px-1.5 py-1.5 transition-colors md:px-2",
        "hover:bg-muted/50",
        active ? "bg-muted/40" : "",
      ].join(" ")}
    >
      <MiniBar label="Work" pct={workPct} variant="skill" />
    </button>
  );
}

function MiniBar({
  label,
  pct,
  variant,
}: {
  label: string;
  pct: number;
  variant: "skill" | "contract";
}) {
  return (
    <span className="inline-flex items-center gap-1 md:gap-1.5">
      <PixelHud size="xs" tone="muted" className="hidden leading-none sm:inline">
        {label}
      </PixelHud>
      <span className="inline-block w-[44px] md:hidden">
        <PixelBar score={pct} cells={8} height={6} variant={variant} />
      </span>
      <span className="hidden w-[72px] md:inline-block">
        <PixelBar score={pct} cells={12} height={6} variant={variant} />
      </span>
      <span className="font-mono text-[10px] tabular-nums leading-none text-muted-foreground">
        {pct}%
      </span>
    </span>
  );
}
