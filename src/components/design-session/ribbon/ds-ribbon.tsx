"use client";

import { useEffect, useRef } from "react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import type { StepDef } from "@/lib/design-session-steps";
import { VitorIcon } from "@/components/icons/vitor-icon";

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
 * Top sticky ribbon for navigating Design Session steps.
 *
 * Desktop (≥md): one tab per step. Each shows `[●] N·Nome` where the dot
 * color encodes status:
 *  - done    → green (steps before current)
 *  - active  → primary (current step)
 *  - pending → muted (steps after current)
 *
 * Mobile (<md): a single dropdown (`DSStepSelect`) — the row doesn't fit a
 * phone, so the current step is shown and the rest open on tap.
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
      <div className="flex items-center gap-1 px-3 py-2 md:px-6">
        {leftSlot ? (
          <div className="flex shrink-0 items-center gap-1 pr-2">
            {leftSlot}
          </div>
        ) : null}
        {/* Mobile (<md): a single dropdown replaces the tab row — the 10
            steps don't fit a phone width, and a list-on-tap beats a
            horizontal scroll the user has to hunt through. */}
        <DSStepSelect
          steps={steps}
          currentStep={currentStep}
          onStepClick={onStepClick}
          className="min-w-0 flex-1 md:hidden"
        />
        {/* Desktop (≥md): the full scannable tab row. */}
        <nav
          aria-label="Etapas da Design Session"
          className="hidden min-w-0 flex-1 flex-nowrap items-center gap-0.5 overflow-x-auto scrollbar-none md:flex md:gap-1"
        >
          {steps.map((step) => (
            <DSRibbonTab
              key={step.key}
              stepKey={step.key}
              number={step.index + 1}
              name={step.title}
              description={step.description}
              status={stepStatus(step.index, currentStep)}
              onClick={() => onStepClick(step.index)}
            />
          ))}
        </nav>
        {rightSlot ? (
          <div className="flex shrink-0 items-center gap-1 pl-2">
            {rightSlot}
          </div>
        ) : null}
      </div>
    </div>
  );
}

function stepStatus(index: number, currentStep: number): TabStatus {
  if (index < currentStep) return "done";
  if (index === currentStep) return "active";
  return "pending";
}

/**
 * Mobile step picker — collapsed trigger shows the active step
 * (`● N · Nome  N/total`), tapping opens the full list with a status dot
 * per step and a check on the current one.
 */
function DSStepSelect({
  steps,
  currentStep,
  onStepClick,
  className,
}: {
  steps: StepDef[];
  currentStep: number;
  onStepClick: (index: number) => void;
  className?: string;
}) {
  const active = steps[currentStep];
  return (
    <Select
      value={String(currentStep)}
      onValueChange={(value) => onStepClick(Number(value))}
    >
      <SelectTrigger
        size="sm"
        aria-label="Escolher etapa da Design Session"
        className={cn("w-full justify-between", className)}
      >
        <SelectValue>
          {active ? (
            <span className="flex min-w-0 items-center gap-1.5">
              <StepGlyph stepKey={active.key} status="active" />
              <span className="tabular-nums">{currentStep + 1}</span>
              <span className="truncate font-medium">· {active.title}</span>
              <span className="shrink-0 text-muted-foreground tabular-nums">
                {currentStep + 1}/{steps.length}
              </span>
            </span>
          ) : null}
        </SelectValue>
      </SelectTrigger>
      <SelectContent>
        {steps.map((step) => (
          <SelectItem key={step.key} value={String(step.index)}>
            <StepGlyph stepKey={step.key} status={stepStatus(step.index, currentStep)} />
            <span className="tabular-nums">{step.index + 1}</span>
            <span className="truncate">{step.title}</span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

type TabStatus = "done" | "active" | "pending";

function DSRibbonTab({
  stepKey,
  number,
  name,
  description,
  status,
  onClick,
}: {
  stepKey: string;
  number: number;
  name: string;
  description: string;
  status: TabStatus;
  onClick: () => void;
}) {
  const isActive = status === "active";
  const ref = useRef<HTMLButtonElement | null>(null);

  // Keep the active tab in view as the user advances — the ribbon scrolls
  // horizontally on narrow viewports, so the current step can land off-screen.
  useEffect(() => {
    if (!isActive || !ref.current) return;
    const el = ref.current;
    requestAnimationFrame(() => {
      el.scrollIntoView({ behavior: "smooth", inline: "center", block: "nearest" });
    });
  }, [isActive]);

  return (
    <Tooltip>
      <TooltipTrigger
        render={(props) => (
          <button
            type="button"
            {...props}
            ref={(node: HTMLButtonElement | null) => {
              ref.current = node;
              const r = (props as { ref?: React.Ref<HTMLButtonElement> }).ref;
              if (typeof r === "function") r(node);
              else if (r) (r as React.MutableRefObject<HTMLButtonElement | null>).current = node;
            }}
            onClick={onClick}
            aria-current={isActive ? "step" : undefined}
            className={cn(
              "group inline-flex shrink-0 items-center gap-1.5 rounded-md px-2 py-1.5",
              "text-xs transition-colors",
              "hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              isActive && "bg-muted/40 text-foreground",
              status === "done" && "text-muted-foreground",
              status === "pending" && "text-muted-foreground/70",
            )}
          >
            <StepGlyph stepKey={stepKey} status={status} />
            <span className="tabular-nums">{number}</span>
            {/* Name is always shown ≥md; on mobile only the active step expands
                to show its name, keeping the row scannable. */}
            <span
              className={cn(
                "md:inline",
                isActive ? "inline font-medium" : "hidden",
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

/**
 * Per-step glyph. The `pre_work` step is Vitor's territory — show the
 * VitorIcon mini glyph instead of the generic status dot, tinted by status.
 */
function StepGlyph({
  stepKey,
  status,
}: {
  stepKey: string;
  status: TabStatus;
}) {
  if (stepKey === "pre_work") {
    return (
      <VitorIcon
        size={14}
        strokeWidth={2.2}
        className={cn(
          "shrink-0",
          status === "done" && "text-emerald-500",
          status === "active" && "text-primary",
          status === "pending" && "text-muted-foreground/60",
        )}
      />
    );
  }
  return <StatusDot status={status} />;
}
