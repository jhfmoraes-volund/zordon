"use client";

import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { ACCENT_CLASSES, type Accent } from "./tokens";

type BoardEmptyStateProps = {
  icon: LucideIcon;
  accent: Accent;
  title: string;
  hint?: string;
};

export function BoardEmptyState({
  icon: Icon,
  accent,
  title,
  hint,
}: BoardEmptyStateProps) {
  const tone = ACCENT_CLASSES[accent].emptyIcon;
  return (
    <div className="flex flex-col items-center justify-center gap-2 py-10 text-center">
      <Icon className={cn("size-12", tone)} strokeWidth={1.5} />
      <p className="text-xs font-medium text-foreground/80">{title}</p>
      {hint ? (
        <p className="max-w-[280px] text-[11px] leading-snug text-muted-foreground">
          {hint}
        </p>
      ) : null}
    </div>
  );
}
