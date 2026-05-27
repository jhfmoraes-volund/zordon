"use client";

import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import type { StepDef } from "@/lib/design-session-steps";

type Props = {
  steps: StepDef[];
  currentStep: number;
  onStepClick: (index: number) => void;
  /** Left side of ribbon — typically a back button. */
  leftSlot?: React.ReactNode;
  /** Right side of ribbon — actions like Memória, toggle Vitor, etc. */
  rightSlot?: React.ReactNode;
  className?: string;
};

/**
 * Top sticky ribbon with one tab per Design Session step.
 *
 * Each tab shows `[●] N·Nome` where the dot color encodes status:
 *  - done    → green (steps before current)
 *  - active  → primary (current step)
 *  - pending → muted (steps after current)
 *
 * Counters / subtitles live in the step sub-header, not here — the ribbon
 * stays scannable across all 10 inception steps.
 */
export function DSRibbon({
  steps,
  currentStep,
  onStepClick,
  leftSlot,
  rightSlot,
  className,
}: Props) {
  return (
    <div
      className={cn(
        "sticky top-0 z-20 border-b bg-background/80 backdrop-blur",
        className,
      )}
    >
      <div className="flex items-center gap-1 overflow-x-auto px-3 py-2 md:px-4">
        {leftSlot ? (
          <div className="flex shrink-0 items-center gap-1 pr-2">
            {leftSlot}
          </div>
        ) : null}
        <nav
          aria-label="Etapas da Design Session"
          className="flex flex-nowrap items-center gap-0.5 md:gap-1"
        >
          {steps.map((step) => {
            const status: TabStatus =
              step.index < currentStep
                ? "done"
                : step.index === currentStep
                  ? "active"
                  : "pending";
            return (
              <DSRibbonTab
                key={step.key}
                number={step.index + 1}
                name={step.title}
                description={step.description}
                status={status}
                onClick={() => onStepClick(step.index)}
              />
            );
          })}
        </nav>
        {rightSlot ? (
          <div className="ml-auto flex shrink-0 items-center gap-1 pl-2">
            {rightSlot}
          </div>
        ) : null}
      </div>
    </div>
  );
}

type TabStatus = "done" | "active" | "pending";

function DSRibbonTab({
  number,
  name,
  description,
  status,
  onClick,
}: {
  number: number;
  name: string;
  description: string;
  status: TabStatus;
  onClick: () => void;
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={(props) => (
          <button
            type="button"
            {...props}
            onClick={onClick}
            aria-current={status === "active" ? "step" : undefined}
            className={cn(
              "group inline-flex shrink-0 items-center gap-1.5 rounded-md px-2 py-1.5",
              "text-xs transition-colors",
              "hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              status === "active" && "bg-muted/40 text-foreground",
              status === "done" && "text-muted-foreground",
              status === "pending" && "text-muted-foreground/70",
            )}
          >
            <StatusDot status={status} />
            <span className="tabular-nums">{number}</span>
            <span
              className={cn(
                "hidden md:inline",
                status === "active" && "font-medium",
              )}
            >
              {name}
            </span>
          </button>
        )}
      />
      <TooltipContent side="bottom" className="max-w-xs">
        <p className="font-medium">
          {number}. {name}
        </p>
        <p className="mt-1 text-xs text-muted-foreground">{description}</p>
      </TooltipContent>
    </Tooltip>
  );
}

function StatusDot({ status }: { status: TabStatus }) {
  return (
    <span
      aria-hidden
      className={cn(
        "inline-block h-2 w-2 rounded-full",
        status === "done" && "bg-emerald-500",
        status === "active" && "bg-primary ring-2 ring-primary/30",
        status === "pending" && "bg-muted-foreground/30",
      )}
    />
  );
}
