"use client";

import { cn } from "@/lib/utils";
import {
  SEVERITY_TONE_CHIP,
  SEVERITY_LABEL,
  type SeverityTone,
} from "./tokens";

type ChipTone =
  | "neutral"
  | "red"
  | "amber"
  | "emerald"
  | "sky"
  | "violet"
  | "indigo"
  | "rose";

const CHIP_TONE: Record<ChipTone, string> = {
  neutral: "border-border/60 bg-background/60 text-muted-foreground",
  red: "border-red-500/30 bg-red-500/15 text-red-600 dark:text-red-300",
  amber:
    "border-amber-500/30 bg-amber-500/15 text-amber-700 dark:text-amber-300",
  emerald:
    "border-emerald-500/30 bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
  sky: "border-sky-500/30 bg-sky-500/15 text-sky-700 dark:text-sky-300",
  violet:
    "border-violet-500/30 bg-violet-500/15 text-violet-700 dark:text-violet-300",
  indigo:
    "border-indigo-500/30 bg-indigo-500/15 text-indigo-700 dark:text-indigo-300",
  rose: "border-rose-500/30 bg-rose-500/15 text-rose-700 dark:text-rose-300",
};

type ChipProps = {
  tone?: ChipTone;
  mono?: boolean;
  truncate?: boolean;
  className?: string;
  children: React.ReactNode;
  /** Optional aria-label override. */
  ariaLabel?: string;
};

export function Chip({
  tone = "neutral",
  mono = false,
  truncate = false,
  className,
  children,
  ariaLabel,
}: ChipProps) {
  return (
    <span
      aria-label={ariaLabel}
      className={cn(
        "inline-flex h-5 items-center rounded-full border px-2 text-[10px] uppercase tracking-wider",
        mono ? "font-mono normal-case" : "font-medium",
        truncate ? "max-w-[140px] truncate" : "",
        CHIP_TONE[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

export function SeverityChip({ severity }: { severity: SeverityTone }) {
  return (
    <span
      aria-label={`Severidade ${SEVERITY_LABEL[severity]}`}
      className={cn(
        "inline-flex h-5 items-center rounded-full border px-2 text-[10px] font-medium uppercase tracking-wider",
        SEVERITY_TONE_CHIP[severity],
      )}
    >
      {SEVERITY_LABEL[severity]}
    </span>
  );
}
