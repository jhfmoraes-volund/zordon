"use client";

import { useState, type ReactNode } from "react";
import { ChevronDown, ChevronRight, FileText, Sparkles } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type {
  GhostTaskNode,
  HierarchyStoryNode,
  RowDecoration,
} from "./types";
import { DecorationPin, TaskRow } from "./task-row";

type Props = {
  story: HierarchyStoryNode;
  /** Decorações no header da story (ex: ? revisar pending). */
  decorations?: RowDecoration[];
  /** Ghost tasks (create proposals) renderizadas após as tasks reais. */
  ghostTasks?: GhostTaskNode[];
  /** Resolve decorações por task id (passa pro TaskRow). */
  getTaskDecorations?: (taskId: string) => RowDecoration[] | undefined;
  /** Slot opcional pra ações custom à direita do título (ex: botões do Vitor). */
  extraActions?: ReactNode;
  onOpenStory?: (storyRef: string) => void;
  onOpenTask?: (taskId: string) => void;
  onOpenAction?: (actionId: string) => void;
};

export function StoryRow({
  story,
  decorations,
  ghostTasks,
  getTaskDecorations,
  extraActions,
  onOpenStory,
  onOpenTask,
  onOpenAction,
}: Props) {
  const totalChildren = story.tasks.length + (ghostTasks?.length ?? 0);
  const [expanded, setExpanded] = useState(false);

  const refinementBadge = (() => {
    if (story.refinementStatus === "committed") {
      return (
        <Badge className="bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border-0 text-[10px] py-0 h-5">
          committed
        </Badge>
      );
    }
    if (story.refinementStatus === "refined") {
      return (
        <Badge className="bg-blue-500/15 text-blue-700 dark:text-blue-400 border-0 text-[10px] py-0 h-5">
          refined
        </Badge>
      );
    }
    return (
      <Badge
        variant="outline"
        className="text-[10px] py-0 h-5 text-muted-foreground"
      >
        draft
      </Badge>
    );
  })();

  const showChildren = totalChildren > 0 && expanded;

  return (
    <li className="px-3 py-2">
      <div className="flex items-start gap-2">
        <button
          type="button"
          onClick={() => setExpanded(!expanded)}
          className="mt-0.5 text-muted-foreground hover:text-foreground"
          title={totalChildren > 0 ? "Expandir tasks" : ""}
          disabled={totalChildren === 0}
        >
          {totalChildren > 0 ? (
            expanded ? (
              <ChevronDown className="h-3.5 w-3.5" />
            ) : (
              <ChevronRight className="h-3.5 w-3.5" />
            )
          ) : (
            <span className="block w-3.5 h-3.5" />
          )}
        </button>

        <FileText className="h-3.5 w-3.5 mt-1 shrink-0 text-muted-foreground" />

        {onOpenStory ? (
          <button
            type="button"
            onClick={() => onOpenStory(story.reference)}
            className="flex-1 min-w-0 text-left rounded -mx-1 px-1 py-0.5 hover:bg-accent/40 transition-colors"
            title="Abrir detalhes da story"
          >
            <StoryHeader
              story={story}
              refinementBadge={refinementBadge}
              decorations={decorations}
              onOpenAction={onOpenAction}
            />
          </button>
        ) : (
          <div className="flex-1 min-w-0">
            <StoryHeader
              story={story}
              refinementBadge={refinementBadge}
              decorations={decorations}
              onOpenAction={onOpenAction}
            />
          </div>
        )}

        {extraActions && (
          <div className="flex items-center gap-1 shrink-0">{extraActions}</div>
        )}
      </div>

      {showChildren && (
        <ul className="mt-2 ml-7 space-y-1">
          {story.tasks.map((t) => (
            <li key={t.id}>
              <TaskRow
                task={t}
                decorations={getTaskDecorations?.(t.id)}
                onOpenTask={onOpenTask}
                onOpenAction={onOpenAction}
              />
            </li>
          ))}
          {ghostTasks?.map((g) => (
            <li key={g.actionId}>
              <GhostTaskRow ghost={g} onOpenAction={onOpenAction} />
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}

function StoryHeader({
  story,
  refinementBadge,
  decorations,
  onOpenAction,
}: {
  story: HierarchyStoryNode;
  refinementBadge: ReactNode;
  decorations?: RowDecoration[];
  onOpenAction?: (actionId: string) => void;
}) {
  return (
    <>
      <div className="flex items-center gap-2 flex-wrap">
        <code className="text-[10px] font-mono text-muted-foreground">
          {story.reference}
        </code>
        <span className="text-sm font-medium truncate">{story.title}</span>
        {refinementBadge}
        {story.persona && (
          <Badge variant="outline" className="text-[10px] py-0 h-5">
            👤 {story.persona.name}
          </Badge>
        )}
        {decorations?.map((d) => (
          <DecorationPin
            key={d.id}
            decoration={d}
            onClick={
              onOpenAction
                ? (e) => {
                    e.stopPropagation();
                    e.preventDefault();
                    onOpenAction(d.id);
                  }
                : undefined
            }
          />
        ))}
        <span className="text-[10px] text-muted-foreground tabular-nums ml-auto">
          {story.acProductCount} AC · {story.tasks.length} tasks
        </span>
      </div>
      {story.want && (
        <p className="text-xs text-muted-foreground line-clamp-1 mt-0.5">
          {story.want}
        </p>
      )}
    </>
  );
}

function GhostTaskRow({
  ghost,
  onOpenAction,
}: {
  ghost: GhostTaskNode;
  onOpenAction?: (actionId: string) => void;
}) {
  return (
    <button
      type="button"
      onClick={onOpenAction ? () => onOpenAction(ghost.actionId) : undefined}
      className={cn(
        "w-full flex items-start gap-2 px-2 py-1 rounded text-left transition-colors",
        "border border-dashed border-emerald-300/40 dark:border-emerald-700/40",
        onOpenAction && "hover:bg-accent/40 cursor-pointer",
      )}
    >
      <Sparkles className="h-3 w-3 text-emerald-600 dark:text-emerald-400 shrink-0 mt-0.5" />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <DecorationPin decoration={ghost.decoration} />
          <span className="text-xs truncate flex-1">{ghost.title}</span>
          {ghost.confidence != null && (
            <span className="font-mono text-[10px] tabular-nums text-muted-foreground shrink-0">
              {(ghost.confidence * 100).toFixed(0)}%
            </span>
          )}
        </div>
        {ghost.reasoning && (
          <p className="text-[11px] text-muted-foreground line-clamp-1 mt-0.5">
            {ghost.reasoning}
          </p>
        )}
      </div>
    </button>
  );
}
