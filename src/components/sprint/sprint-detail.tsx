"use client";

import { useMemo } from "react";
import {
  CalendarRange,
  CheckCircle2,
  KanbanSquare,
  Pencil,
  Plus,
  Rocket,
  ServerCog,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  TasksList,
  type Member,
  type Module,
  type Story,
  type Task,
} from "@/components/story-hierarchy";
import { SprintBurndown } from "./sprint-burndown";
import { SprintCapacity } from "./sprint-capacity";
import {
  deliveredFpByMember,
  sprintDays,
  sprintFP,
  sprintTaskCounts,
  tasksOfSprint,
} from "./helpers";
import type { Sprint, SprintMemberCapacity } from "./types";

type Props = {
  sprint: Sprint;
  tasks: Task[];
  stories: Story[];
  modules: Module[];
  members: Member[];
  capacities: SprintMemberCapacity[];
  onOpenTask: (taskRef: string) => void;
  onCreateTask?: () => void;
  onEditSprint?: () => void;
  onOpenBoard?: () => void;
};

export function SprintDetail({
  sprint,
  tasks,
  stories,
  modules,
  members,
  capacities,
  onOpenTask,
  onCreateTask,
  onEditSprint,
  onOpenBoard,
}: Props) {
  const own = useMemo(
    () => tasksOfSprint(sprint.id, tasks),
    [sprint.id, tasks],
  );
  const fp = sprintFP(sprint.id, tasks);
  const counts = sprintTaskCounts(sprint.id, tasks);
  const pct = fp.total > 0 ? Math.round((fp.done / fp.total) * 100) : 0;

  const days = sprintDays(sprint);
  const dayPct = Math.round((days.elapsed / days.total) * 100);
  const sprintCaps = capacities.filter((c) => c.sprintId === sprint.id);
  const delivered = useMemo(
    () => deliveredFpByMember(sprint.id, tasks),
    [sprint.id, tasks],
  );

  const hasDeployedStaging = Boolean(sprint.deployedToStagingAt);
  const hasDeployedProd = Boolean(sprint.deployedToProductionAt);

  return (
    <div className="space-y-5">
      {/* Header metrics ────────────────────────────────────────────── */}
      <div className="space-y-3 rounded-xl border bg-card p-4">
        <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
          <Metric label="FP" value={fp.done} sub={`/ ${fp.total}`} />
          <Divider />
          <Metric
            label="Tasks"
            value={counts.done}
            sub={`/ ${counts.total}`}
          />
          <Divider />
          <Metric label="Progresso" value={`${pct}%`} />
          <Divider />
          <Metric
            icon={CalendarRange}
            label="Dias"
            value={days.elapsed}
            sub={`/ ${days.total}`}
          />

          <div className="ml-auto flex flex-wrap gap-1.5">
            {onCreateTask ? (
              <Button size="sm" variant="outline" onClick={onCreateTask}>
                <Plus className="size-3.5" />
                Nova task
              </Button>
            ) : null}
            {onEditSprint ? (
              <Button size="sm" variant="outline" onClick={onEditSprint}>
                <Pencil className="size-3.5" />
                Editar
              </Button>
            ) : null}
            {onOpenBoard ? (
              <Button size="sm" variant="outline" onClick={onOpenBoard}>
                <KanbanSquare className="size-3.5" />
                Board
              </Button>
            ) : null}
          </div>
        </div>

        {/* Dual progress: work done vs days elapsed */}
        <div className="space-y-1.5">
          <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
            <span className="w-12 shrink-0">Work</span>
            <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
              <div
                className="h-full bg-primary transition-[width]"
                style={{ width: `${pct}%` }}
              />
            </div>
            <span className="w-10 text-right font-mono tabular-nums">
              {pct}%
            </span>
          </div>
          <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
            <span className="w-12 shrink-0">Tempo</span>
            <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
              <div
                className="h-full bg-amber-500/70 transition-[width]"
                style={{ width: `${dayPct}%` }}
              />
            </div>
            <span className="w-10 text-right font-mono tabular-nums">
              {dayPct}%
            </span>
          </div>
        </div>

        {/* Deploy status */}
        {(hasDeployedStaging || hasDeployedProd) ? (
          <div className="flex flex-wrap items-center gap-3 border-t pt-3 text-xs">
            <span className="inline-flex items-center gap-1 text-muted-foreground">
              <Rocket className="size-3.5" />
              Deploy
            </span>
            <DeployBadge
              icon={ServerCog}
              label="staging"
              date={sprint.deployedToStagingAt ?? null}
            />
            <DeployBadge
              icon={CheckCircle2}
              label="production"
              date={sprint.deployedToProductionAt ?? null}
            />
          </div>
        ) : null}
      </div>

      {/* Burndown ───────────────────────────────────────────────────── */}
      <SprintBurndown sprint={sprint} tasks={tasks} />

      {/* Capacity ────────────────────────────────────────────────────── */}
      <section className="space-y-2 rounded-xl border bg-card p-4">
        <h3 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          Capacity
        </h3>
        <SprintCapacity
          capacities={sprintCaps}
          members={members}
          deliveredFp={delivered}
        />
      </section>

      {/* Tasks ──────────────────────────────────────────────────────── */}
      <section className="space-y-2">
        <h3 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          Tasks do sprint
        </h3>
        <TasksList
          tasks={own}
          stories={stories}
          modules={modules}
          members={members}
          onOpenTask={onOpenTask}
        />
      </section>
    </div>
  );
}

// ─── Internals ───────────────────────────────────────────────────────────────

function Metric({
  icon: Icon,
  label,
  value,
  sub,
}: {
  icon?: typeof CalendarRange;
  label: string;
  value: string | number;
  sub?: string;
}) {
  return (
    <div className="space-y-0.5">
      <p className="inline-flex items-center gap-1 text-[10px] uppercase tracking-wider text-muted-foreground">
        {Icon ? <Icon className="size-3" /> : null}
        {label}
      </p>
      <p className="text-xl font-bold tabular-nums">
        {value}
        {sub ? (
          <span className="text-base font-normal text-muted-foreground">
            {" "}
            {sub}
          </span>
        ) : null}
      </p>
    </div>
  );
}

function Divider() {
  return <div className="h-10 w-px bg-border" />;
}

function DeployBadge({
  icon: Icon,
  label,
  date,
}: {
  icon: typeof Rocket;
  label: string;
  date: string | null;
}) {
  if (!date) {
    return (
      <span className="inline-flex items-center gap-1 rounded-md border border-dashed px-2 py-0.5 text-[10px] text-muted-foreground">
        <Icon className="size-3" />
        {label} pendente
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 rounded-md border border-green-500/30 bg-green-500/10 px-2 py-0.5 text-[10px] text-green-700 dark:text-green-300">
      <Icon className="size-3" />
      {label}
      <span className="font-mono opacity-70">· {date.slice(0, 10)}</span>
    </span>
  );
}
