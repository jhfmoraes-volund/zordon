"use client";

import { Info } from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { ACCENT_CLASSES, type Accent } from "./tokens";
import { BOARD_MAX_WIDTH, type BoardLayoutCols } from "./board-layout";

type StepHeaderProps = {
  /**
   * Width budget matching the BoardLayout that follows. Required so the
   * header and the board grid below it share the same horizontal axis —
   * otherwise headers feel "stuck to the left" against wider boards.
   */
  cols: BoardLayoutCols;
  /** Single-paragraph description. Multiple <p>s can be passed via children. */
  description?: React.ReactNode;
  /** Optional glossary/key items rendered as chips with tooltip hints. */
  legend?: StepLegendItem[];
  /** Optional override for the legend's "what each one means" intro line. */
  legendLabel?: string;
  /** Extra slot below legend (e.g. action button, link). */
  children?: React.ReactNode;
  className?: string;
};

export type StepLegendItem = {
  /** Short label, rendered uppercase + tonal (e.g. "É", "MVP", "ALTA"). */
  label: string;
  /** Optional accent for the chip tint + label color. */
  accent?: Accent;
  /** Hint shown in the tooltip. */
  hint: string;
};

/**
 * Canonical header for every Design Session step. Sits above the boards
 * and shares the BoardLayout's max-width so both are centered on the same
 * axis. Description caps at 720px for legibility regardless of cols.
 */
export function StepHeader({
  cols,
  description,
  legend,
  legendLabel = "O que cada coluna significa",
  children,
  className,
}: StepHeaderProps) {
  return (
    <header
      className={cn("mx-auto w-full", BOARD_MAX_WIDTH[cols], className)}
    >
      <div className="max-w-[720px] space-y-3">
        {description ? (
          <div className="text-[13.5px] leading-relaxed text-muted-foreground">
            {description}
          </div>
        ) : null}

        {legend && legend.length > 0 ? (
          <TooltipProvider delay={150}>
            <div className="flex flex-wrap items-center gap-2">
              <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
                {legendLabel}
                <Info className="size-3" strokeWidth={1.75} />
              </span>
              {legend.map((item) => (
                <LegendChip key={item.label} item={item} />
              ))}
            </div>
          </TooltipProvider>
        ) : null}

        {children}
      </div>
    </header>
  );
}

function LegendChip({ item }: { item: StepLegendItem }) {
  const cls = item.accent ? ACCENT_CLASSES[item.accent] : null;
  return (
    <Tooltip>
      <TooltipTrigger
        render={(props) => (
          <span
            {...props}
            tabIndex={0}
            className={cn(
              "inline-flex h-5 cursor-help items-center rounded-full px-2 font-mono text-[10px] font-medium uppercase tracking-[0.04em] ring-1 ring-inset outline-none transition-colors focus-visible:ring-2",
              cls
                ? cn(cls.iconBg, cls.chip, "ring-[var(--accent-surface-ring)]")
                : "bg-foreground/[0.04] text-foreground/80 ring-[var(--accent-surface-ring)]",
            )}
          >
            {item.label}
          </span>
        )}
      />
      <TooltipContent>{item.hint}</TooltipContent>
    </Tooltip>
  );
}
