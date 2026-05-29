"use client";

import { Wrench } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { HierarchyTaskNode, RowDecoration } from "./types";

const DECORATION_TONE: Record<RowDecoration["tone"], string> = {
  create:
    "border-emerald-300/60 bg-emerald-50 text-emerald-700 dark:border-emerald-900/50 dark:bg-emerald-950/40 dark:text-emerald-300",
  update:
    "border-sky-300/60 bg-sky-50 text-sky-700 dark:border-sky-900/50 dark:bg-sky-950/40 dark:text-sky-300",
  delete:
    "border-rose-300/60 bg-rose-50 text-rose-700 dark:border-rose-900/50 dark:bg-rose-950/40 dark:text-rose-300",
  move:
    "border-amber-300/60 bg-amber-50 text-amber-700 dark:border-amber-900/50 dark:bg-amber-950/40 dark:text-amber-300",
  review:
    "border-cyan-300/60 bg-cyan-50 text-cyan-700 dark:border-cyan-900/50 dark:bg-cyan-950/40 dark:text-cyan-300",
};

type Props = {
  task: HierarchyTaskNode;
  decorations?: RowDecoration[];
  onOpenTask?: (taskId: string) => void;
  onOpenAction?: (actionId: string) => void;
};

export function TaskRow({ task, decorations, onOpenTask, onOpenAction }: Props) {
  const hasDelete = decorations?.some((d) => d.strikethrough) ?? false;
  const isEligible = task.membership === "eligible";

  return (
    <button
      type="button"
      onClick={onOpenTask ? () => onOpenTask(task.id) : undefined}
      disabled={!onOpenTask}
      className={cn(
        "w-full flex items-center gap-2 px-2 py-1 rounded text-left transition-colors",
        onOpenTask && "hover:bg-accent/40 cursor-pointer",
        !onOpenTask && "cursor-default",
        isEligible && "opacity-65",
      )}
    >
      <Wrench className="h-3 w-3 text-muted-foreground shrink-0" />
      <code className="text-[10px] font-mono text-muted-foreground shrink-0">
        {task.reference ?? "—"}
      </code>
      <span
        className={cn(
          "text-xs truncate flex-1",
          hasDelete && "line-through text-muted-foreground",
        )}
      >
        {task.title}
      </span>

      {/* Decorações inline (≠ update, − delete, → move, ? review) */}
      {decorations?.map((d) => (
        <DecorationPin
          key={d.id}
          decoration={d}
          onClick={
            onOpenAction
              ? (e) => {
                  e.stopPropagation();
                  onOpenAction(d.id);
                }
              : undefined
          }
        />
      ))}

      <Badge
        variant="outline"
        className={cn(
          "text-[10px] py-0 h-5",
          task.status === "draft"
            ? "text-muted-foreground"
            : "text-blue-700 dark:text-blue-400 border-blue-500/30",
        )}
      >
        {task.status}
      </Badge>
      <span className="text-[10px] text-muted-foreground tabular-nums shrink-0">
        {task.functionPoints ?? 0} FP · {task.scope}
      </span>
    </button>
  );
}

function DecorationPin({
  decoration,
  onClick,
}: {
  decoration: RowDecoration;
  onClick?: (e: React.MouseEvent) => void;
}) {
  return (
    <span
      role={onClick ? "button" : undefined}
      onClick={onClick}
      title={decoration.hint ?? decoration.label}
      className={cn(
        "inline-flex shrink-0 items-center gap-0.5 rounded-sm border px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide transition-colors",
        DECORATION_TONE[decoration.tone],
        onClick && "cursor-pointer hover:opacity-80",
      )}
    >
      <span aria-hidden className="font-mono">
        {decoration.glyph}
      </span>
      {decoration.label}
    </span>
  );
}

export { DecorationPin };
