"use client";

import { Inbox, Layers, Plus, Sparkles } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ComputedStatusChip, RefinementChip } from "./chips";
import {
  computeStatus,
  fpOfStory,
  taskCountsOfStory,
} from "./helpers";
import { StoryRowMenu } from "./story-row-menu";
import type { Module, Story, Task } from "./types";

type StoriesListProps = {
  stories: Story[];
  tasks: Task[];
  modules: Module[];
  onOpenStory: (ref: string) => void;
  onCreateStory?: () => void;
  onDeleteStory?: (ref: string) => void;
};

export function StoriesList({
  stories,
  tasks,
  modules,
  onOpenStory,
  onCreateStory,
  onDeleteStory,
}: StoriesListProps) {
  const groups = modules
    .map((m) => ({
      module: m,
      rows: stories.filter((s) => s.moduleId === m.id),
    }))
    .filter((g) => g.rows.length > 0);

  const inbox = stories.filter((s) => s.moduleId === null);
  const doneCount = stories.filter(
    (s) => computeStatus(s, tasks) === "done",
  ).length;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="text-xs text-muted-foreground">
          <span className="font-mono tabular-nums">{stories.length}</span>{" "}
          stories ·{" "}
          <span className="font-mono tabular-nums">{doneCount}</span> done
        </div>
        {onCreateStory ? (
          <Button size="sm" onClick={onCreateStory}>
            <Plus className="size-3.5" />
            Nova story
          </Button>
        ) : null}
      </div>

      {groups.map((g) => (
        <StoryGroup
          key={g.module.id}
          title={g.module.name}
          subtitle={g.module.description ?? ""}
          rows={g.rows}
          tasks={tasks}
          modules={modules}
          onOpenStory={onOpenStory}
          onDeleteStory={onDeleteStory}
        />
      ))}

      {inbox.length > 0 ? (
        <StoryGroup
          inbox
          title="INBOX"
          subtitle="stories sem módulo · aguardando triagem do PM"
          rows={inbox}
          tasks={tasks}
          modules={modules}
          onOpenStory={onOpenStory}
          onDeleteStory={onDeleteStory}
        />
      ) : null}
    </div>
  );
}

function StoryGroup({
  title,
  subtitle,
  rows,
  tasks,
  modules,
  onOpenStory,
  onDeleteStory,
  inbox = false,
}: {
  title: string;
  subtitle: string;
  rows: Story[];
  tasks: Task[];
  modules: Module[];
  onOpenStory: (ref: string) => void;
  onDeleteStory?: (ref: string) => void;
  inbox?: boolean;
}) {
  const showMenu = !!onDeleteStory;
  const gridCols = showMenu
    ? "grid-cols-[96px_minmax(200px,1fr)_minmax(180px,220px)_120px_120px_88px_88px_40px]"
    : "grid-cols-[96px_minmax(200px,1fr)_minmax(180px,220px)_120px_120px_88px_88px]";
  return (
    <section className="space-y-2">
      <div className="flex items-baseline gap-2">
        <h2
          className={`inline-flex items-center gap-1.5 font-mono text-sm font-semibold ${
            inbox ? "text-amber-700 dark:text-amber-400" : ""
          }`}
        >
          {inbox ? (
            <Inbox className="size-4" />
          ) : (
            <Layers className="size-4 text-muted-foreground" />
          )}
          {title}
        </h2>
        <span className="text-xs text-muted-foreground">· {subtitle}</span>
        <span className="ml-auto text-xs text-muted-foreground">
          <span className="font-mono tabular-nums">{rows.length}</span> stories
        </span>
      </div>

      {/* Legacy pattern: container has rounded border + overflow-hidden for the
          radius mask; an inner overflow-x-auto wrapper handles horizontal
          scrolling on narrow viewports without leaking past the radius. */}
      <div
        className={`overflow-hidden rounded-xl border ${
          inbox ? "border-amber-500/30 bg-amber-500/5" : ""
        }`}
      >
        <div className="overflow-x-auto">
          <div className={showMenu ? "min-w-[1080px]" : "min-w-[1040px]"}>
            <div
              className={`grid ${gridCols} gap-3 border-b bg-muted/30 px-3 py-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground`}
            >
              <span>Ref</span>
              <span>Título</span>
              <span>Módulo</span>
              <span>Refinement</span>
              <span>Status</span>
              <span className="text-right">Tasks</span>
              <span className="text-right">FP</span>
              {showMenu ? <span /> : null}
            </div>
            {rows.map((story, i) => (
              <StoryRow
                key={story.reference}
                story={story}
                tasks={tasks}
                modules={modules}
                isLast={i === rows.length - 1}
                gridCols={gridCols}
                onOpen={() => onOpenStory(story.reference)}
                onDelete={onDeleteStory}
              />
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

function StoryRow({
  story,
  tasks,
  modules,
  isLast,
  gridCols,
  onOpen,
  onDelete,
}: {
  story: Story;
  tasks: Task[];
  modules: Module[];
  isLast: boolean;
  gridCols: string;
  onOpen: () => void;
  onDelete?: (ref: string) => void;
}) {
  const mod = modules.find((m) => m.id === story.moduleId);
  const fps = fpOfStory(story, tasks);
  const counts = taskCountsOfStory(story, tasks);
  const status = computeStatus(story, tasks);

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onOpen();
        }
      }}
      className={`grid w-full cursor-pointer ${gridCols} items-center gap-3 px-3 py-2.5 text-left text-sm transition-colors hover:bg-muted/40 ${
        !isLast ? "border-b" : ""
      }`}
    >
      <span className="font-mono text-xs text-muted-foreground">
        {story.reference}
      </span>

      <span className="flex min-w-0 items-center gap-2">
        <span className="truncate">{story.title}</span>
        {story.createdByAgent ? (
          <Sparkles className="size-3 shrink-0 text-muted-foreground/60" />
        ) : null}
      </span>

      <span className="flex min-w-0 items-center">
        {mod ? (
          <Badge
            variant="outline"
            className="block max-w-full truncate font-mono text-[10px]"
            title={mod.name}
          >
            {mod.name}
          </Badge>
        ) : story.proposedModuleName ? (
          <Badge
            variant="outline"
            className="block max-w-full truncate border-amber-500/40 font-mono text-[10px] text-amber-700 dark:text-amber-400"
            title={story.proposedModuleName}
          >
            ≈ {story.proposedModuleName}
          </Badge>
        ) : (
          <span className="text-[10px] text-muted-foreground">—</span>
        )}
      </span>

      <span>
        <RefinementChip status={story.refinementStatus} />
      </span>
      <span>
        <ComputedStatusChip status={status} />
      </span>

      <span className="text-right font-mono text-xs tabular-nums text-muted-foreground">
        {counts.total === 0 ? "—" : `${counts.done}/${counts.total}`}
      </span>
      <span className="text-right font-mono text-xs tabular-nums">
        {fps.total === 0 ? "—" : `${fps.done}/${fps.total}`}
      </span>

      {onDelete ? (
        <span className="flex justify-center">
          <StoryRowMenu
            storyRef={story.reference}
            onCopyRef={(ref) => {
              void navigator.clipboard.writeText(ref);
            }}
            onDelete={onDelete}
          />
        </span>
      ) : null}
    </div>
  );
}
