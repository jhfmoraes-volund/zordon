"use client";

import { Users } from "lucide-react";
import { PixelHud } from "@/components/ui/pixel-bar";

type Props = {
  members: number;
  utilPct: number;
  active: boolean;
  onToggle: () => void;
};

/**
 * Capacity compacto — N pessoas + utilização %. Tom muda quando passa de 80/100.
 */
export function RibbonCapacityPill({
  members,
  utilPct,
  active,
  onToggle,
}: Props) {
  const tone =
    utilPct >= 100
      ? "text-red-700 dark:text-red-300"
      : utilPct >= 80
        ? "text-amber-700 dark:text-amber-300"
        : "text-foreground";

  return (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={active}
      aria-controls="sprint-ribbon-drawer"
      className={[
        "inline-flex shrink-0 items-center gap-1.5 rounded-md px-1.5 py-1.5 transition-colors md:gap-2 md:px-2",
        "hover:bg-muted/50",
        active ? "bg-muted/40" : "",
      ].join(" ")}
    >
      <Users className="size-3.5 text-muted-foreground" />
      <PixelHud size="xs" tone="muted" className="hidden leading-none sm:inline">
        Cap
      </PixelHud>
      <span className="hidden font-mono text-[11px] tabular-nums leading-none text-muted-foreground sm:inline">
        {members}
      </span>
      <span
        className={`font-mono text-[11px] font-semibold tabular-nums leading-none ${tone}`}
      >
        {utilPct}%
      </span>
    </button>
  );
}
