"use client";

import { PixelHud } from "@/components/ui/pixel-bar";
import { AlphaIcon } from "@/components/icons/alpha-icon";

type Props = {
  count: number;
  /** Highest severity present — drives tone. */
  severity: "warn" | "info" | "ok";
  active: boolean;
  onToggle: () => void;
};

/**
 * Alpha pill — N alertas pendentes. Quando count=0, mostra estado "ok" sutil.
 */
export function RibbonAlertsPill({
  count,
  severity,
  active,
  onToggle,
}: Props) {
  const isOk = severity === "ok" || count === 0;
  const tone = isOk
    ? "text-green-700 dark:text-green-300"
    : severity === "warn"
      ? "text-amber-700 dark:text-amber-300"
      : "text-primary";

  return (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={active}
      aria-controls="sprint-ribbon-drawer"
      className={[
        "inline-flex shrink-0 items-center gap-1 rounded-md px-1.5 py-1.5 transition-colors md:gap-1.5 md:px-2",
        "hover:bg-muted/50",
        active ? "bg-muted/40" : "",
      ].join(" ")}
    >
      <AlphaIcon className={`size-3.5 ${tone}`} />
      <PixelHud size="xs" tone="muted" className="hidden leading-none sm:inline">
        Alpha
      </PixelHud>
      {isOk ? (
        <span className="hidden font-mono text-[10px] tabular-nums leading-none text-muted-foreground sm:inline">
          ok
        </span>
      ) : (
        <span
          className={`font-mono text-[11px] font-semibold tabular-nums leading-none ${tone}`}
        >
          {count}
        </span>
      )}
    </button>
  );
}
