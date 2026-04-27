import { cva, type VariantProps } from "class-variance-authority";
import type { ReactNode } from "react";

import { cn } from "@/lib/utils";
import type { ChipTone } from "@/lib/status-chips";

const chipVariants = cva(
  "inline-flex w-fit shrink-0 items-center justify-center gap-1.5 rounded-full border font-medium leading-none whitespace-nowrap transition-colors",
  {
    variants: {
      tone: {
        blue:   "bg-blue-500/15 text-blue-700 border-blue-500/25 dark:text-blue-300",
        green:  "bg-green-500/15 text-green-700 border-green-500/25 dark:text-green-300",
        amber:  "bg-amber-500/15 text-amber-700 border-amber-500/30 dark:text-amber-300",
        red:    "bg-red-500/15 text-red-700 border-red-500/25 dark:text-red-300",
        purple: "bg-purple-500/15 text-purple-700 border-purple-500/25 dark:text-purple-300",
        cyan:   "bg-cyan-500/15 text-cyan-700 border-cyan-500/25 dark:text-cyan-300",
        teal:   "bg-teal-500/15 text-teal-700 border-teal-500/25 dark:text-teal-300",
        pink:   "bg-pink-500/15 text-pink-700 border-pink-500/25 dark:text-pink-300",
        slate:  "bg-slate-500/15 text-slate-700 border-slate-500/25 dark:text-slate-300",
        brand:  "bg-primary/15 text-primary border-primary/30",
        muted:  "bg-muted text-muted-foreground border-border",
      },
      size: {
        sm: "h-5 px-2 text-[11px]",
        md: "h-6 px-2.5 text-xs",
      },
    },
    defaultVariants: {
      tone: "muted",
      size: "sm",
    },
  },
);

const dotVariants = cva("size-1.5 shrink-0 rounded-full", {
  variants: {
    tone: {
      blue:   "bg-blue-500",
      green:  "bg-green-500",
      amber:  "bg-amber-500",
      red:    "bg-red-500",
      purple: "bg-purple-500",
      cyan:   "bg-cyan-500",
      teal:   "bg-teal-500",
      pink:   "bg-pink-500",
      slate:  "bg-slate-500",
      brand:  "bg-primary",
      muted:  "bg-muted-foreground/40",
    },
  },
  defaultVariants: { tone: "muted" },
});

export type StatusChipProps = Omit<VariantProps<typeof chipVariants>, "tone"> & {
  tone?: ChipTone;
  label?: ReactNode;
  children?: ReactNode;
  dot?: boolean;
  className?: string;
};

export function StatusChip({
  tone = "muted",
  size,
  label,
  children,
  dot = false,
  className,
}: StatusChipProps) {
  return (
    <span className={cn(chipVariants({ tone, size }), className)}>
      {dot ? <span className={dotVariants({ tone })} aria-hidden /> : null}
      {children ?? label}
    </span>
  );
}
