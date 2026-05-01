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
import type { Module, Story, Task } from "./types";

type StoriesListProps = {
  stories: Story[];
  tasks: Task[];
  modules: Module[];
  onOpenStory: (ref: string) => void;
  onCreateStory?: () => void;
};

export function StoriesList({
  stories,
  tasks,
  modules,
  onOpenStory,
  onCreateStory,
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
  inbox = false,
}: {
  title: string;
  subtitle: string;
  rows: Story[];
  tasks: Task[];
  modules: Module[];
  onOpenStory: (ref: string) => void;
  inbox?: boolean;
}) {
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
          <div className="min-w-[1000px]">
            <div className="grid grid-cols-[110px_minmax(220px,1fr)_120px_110px_140px_110px_110px] gap-3 border-b bg-muted/30 px-3 py-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              <span>Ref</span>
              <span>Título</span>
              <span>Módulo</span>
              <span>Refinement</span>
              <span>Status</span>
              <span className="text-right">Tasks</span>
              <span className="text-right">FP</span>
            </div>
            {rows.map((story, i) => (
              <StoryRow
                key={story.reference}
                story={story}
                tasks={tasks}
                modules={modules}
                isLast={i === rows.length - 1}
                onOpen={() => onOpenStory(story.reference)}
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
  onOpen,
}: {
  story: Story;
  tasks: Task[];
  modules: Module[];
  isLast: boolean;
  onOpen: () => void;
}) {
  const mod = modules.find((m) => m.id === story.moduleId);
  const fps = fpOfStory(story, tasks);
  const counts = taskCountsOfStory(story, tasks);
  const status = computeStatus(story, tasks);

  return (
    <button
      type="button"
      onClick={onOpen}
      className={`grid w-full grid-cols-[110px_minmax(220px,1fr)_120px_110px_140px_110px_110px] items-center gap-3 px-3 py-2.5 text-left text-sm transition-colors hover:bg-muted/40 ${
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

      {mod ? (
        <Badge variant="outline" className="w-fit font-mono text-[10px]">
          {mod.name}
        </Badge>
      ) : story.proposedModuleName ? (
        <Badge
          variant="outline"
          className="w-fit border-amber-500/40 font-mono text-[10px] text-amber-700 dark:text-amber-400"
        >
          ≈ {story.proposedModuleName}
        </Badge>
      ) : (
        <span className="text-[10px] text-muted-foreground">—</span>
      )}

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
    </button>
  );
}
