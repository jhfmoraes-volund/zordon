"use client";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import type { StepDef } from "@/lib/design-session-steps";

type Props = {
  step: StepDef;
  totalSteps: number;
  onPrevious: () => void;
  onNext: () => void;
  isFirst: boolean;
  isLast: boolean;
  /** Optional counter shown next to the title (e.g. "0 mapeados"). */
  counter?: React.ReactNode;
  /** Extra actions rendered between counter and prev/next (e.g. Vitor button). */
  actions?: React.ReactNode;
  className?: string;
};

/**
 * Sub-header below the DSRibbon — owns the current step's identity and
 * the linear navigation (Anterior/Próximo). Title is the primary anchor;
 * description fills mental context; counter is contextual (per-step optional).
 *
 * Last step (briefing) hides "Próximo" — governance happens in-place.
 */
export function StepSubHeader({
  step,
  totalSteps,
  onPrevious,
  onNext,
  isFirst,
  isLast,
  counter,
  actions,
  className,
}: Props) {
  return (
    <div
      className={cn(
        "flex items-start justify-between gap-3 border-b bg-background px-3 py-3 sm:px-6",
        className,
      )}
    >
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <h1 className="truncate text-sm font-semibold sm:text-lg">
            {step.title}
          </h1>
          <Badge variant="secondary" className="shrink-0 text-xs">
            {step.index + 1}/{totalSteps}
          </Badge>
          {counter ? (
            <span className="hidden text-xs text-muted-foreground sm:inline">
              · {counter}
            </span>
          ) : null}
        </div>
        <p className="mt-0.5 hidden truncate text-xs text-muted-foreground sm:block">
          {step.description}
        </p>
      </div>

      <div className="flex shrink-0 items-center gap-1 sm:gap-2">
        {actions}
        <Button
          variant="outline"
          size="sm"
          onClick={onPrevious}
          disabled={isFirst}
          aria-label="Anterior"
          className="px-2 sm:px-2.5"
        >
          <ChevronLeft className="h-4 w-4 sm:mr-1" />
          <span className="hidden sm:inline">Anterior</span>
        </Button>
        {!isLast && (
          <Button
            size="sm"
            onClick={onNext}
            aria-label="Proximo"
            className="px-2 sm:px-2.5"
          >
            <span className="hidden sm:inline">Proximo</span>
            <ChevronRight className="h-4 w-4 sm:ml-1" />
          </Button>
        )}
      </div>
    </div>
  );
}
