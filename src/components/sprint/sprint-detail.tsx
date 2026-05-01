"use client";

import { useMemo } from "react";
import {
  TasksList,
  type Member,
  type Module,
  type Story,
  type Task,
  type TaskStatus,
} from "@/components/story-hierarchy";
import { SprintCapacityCard } from "./sprint-capacity-card";
import { SprintPulse } from "./sprint-pulse";
import { tasksOfSprint } from "./helpers";
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
  onPromoteDeploy?: () => void;

  // ─── Inline-edit callbacks (forwarded to TasksList) ────────────────────────
  /** All sprints — used by the inline sprint picker on each task row. */
  allSprints?: Sprint[];
  onChangeTaskStatus?: (taskRef: string, status: TaskStatus) => void;
  onChangeTaskAssignee?: (taskRef: string, memberId: string | null) => void;
  onChangeTaskSprint?: (taskRef: string, sprintId: string | null) => void;
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
  onPromoteDeploy,
  allSprints,
  onChangeTaskStatus,
  onChangeTaskAssignee,
  onChangeTaskSprint,
}: Props) {
  const own = useMemo(
    () => tasksOfSprint(sprint.id, tasks),
    [sprint.id, tasks],
  );

  return (
    <div className="space-y-5">
      {/* Pulse (esquerda, com tabs) + Capacity (direita, fixo) ─────── */}
      <div className="grid gap-5 lg:grid-cols-2">
        <SprintPulse
          sprint={sprint}
          tasks={tasks}
          capacities={capacities}
          onCreateTask={onCreateTask}
          onEditSprint={onEditSprint}
          onOpenBoard={onOpenBoard}
          onPromoteDeploy={onPromoteDeploy}
        />
        <SprintCapacityCard
          sprint={sprint}
          tasks={tasks}
          members={members}
          capacities={capacities}
        />
      </div>

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
          onChangeStatus={onChangeTaskStatus}
          onChangeAssignee={onChangeTaskAssignee}
          sprints={allSprints}
          onChangeSprint={onChangeTaskSprint}
        />
      </section>
    </div>
  );
}
