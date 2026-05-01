"use client";

import { cva } from "class-variance-authority";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ChipTone } from "@/lib/status-chips";

export type TagChipVariant = "solid" | "notion" | "linear";
export type TagChipSize = "sm" | "md";

const solidVariants = cva(
  "inline-flex w-fit shrink-0 items-center gap-1.5 rounded-full border font-medium leading-none whitespace-nowrap transition-colors",
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
    defaultVariants: { tone: "muted", size: "sm" },
  },
);

const notionVariants = cva(
  "inline-flex w-fit shrink-0 items-center gap-1.5 rounded-md bg-muted/60 text-foreground font-medium leading-none whitespace-nowrap transition-colors",
  {
    variants: {
      size: {
        sm: "h-5 px-1.5 text-[11px]",
        md: "h-6 px-2 text-xs",
      },
    },
    defaultVariants: { size: "sm" },
  },
);

const linearVariants = cva(
  "inline-flex w-fit shrink-0 items-center gap-1.5 rounded-full border bg-transparent text-foreground/90 font-medium leading-none whitespace-nowrap transition-colors",
  {
    variants: {
      tone: {
        blue:   "border-blue-500/50",
        green:  "border-green-500/50",
        amber:  "border-amber-500/50",
        red:    "border-red-500/50",
        purple: "border-purple-500/50",
        cyan:   "border-cyan-500/50",
        teal:   "border-teal-500/50",
        pink:   "border-pink-500/50",
        slate:  "border-slate-500/50",
        brand:  "border-primary/50",
        muted:  "border-border",
      },
      size: {
        sm: "h-5 px-2 text-[11px]",
        md: "h-6 px-2.5 text-xs",
      },
    },
    defaultVariants: { tone: "muted", size: "sm" },
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

export type TagChipProps = {
  name: string;
  tone?: ChipTone;
  variant?: TagChipVariant;
  size?: TagChipSize;
  onRemove?: () => void;
  className?: string;
};

export function TagChip({
  name,
  tone = "muted",
  variant = "solid",
  size = "sm",
  onRemove,
  className,
}: TagChipProps) {
  const showDot = variant === "notion" || variant === "linear";
  const wrapperCls =
    variant === "solid"
      ? solidVariants({ tone, size })
      : variant === "notion"
        ? notionVariants({ size })
        : linearVariants({ tone, size });

  return (
    <span className={cn(wrapperCls, className)}>
      {showDot ? <span className={dotVariants({ tone })} aria-hidden /> : null}
      <span className="truncate max-w-[140px]">{name}</span>
      {onRemove ? (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onRemove();
          }}
          className="-mr-0.5 ml-0.5 inline-flex size-3.5 items-center justify-center rounded-sm hover:bg-foreground/10"
          aria-label={`remove ${name}`}
        >
          <X className="size-3" />
        </button>
      ) : null}
    </span>
  );
}

export function TagChipOverflow({
  count,
  variant = "solid",
  size = "sm",
}: {
  count: number;
  variant?: TagChipVariant;
  size?: TagChipSize;
}) {
  if (count <= 0) return null;
  return (
    <TagChip
      name={`+${count}`}
      tone="muted"
      variant={variant}
      size={size}
    />
  );
}
