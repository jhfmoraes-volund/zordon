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
import { tasksOfSprint } from "./helpers";
import type { Sprint } from "./types";

type Props = {
  sprint: Sprint;
  tasks: Task[];
  stories: Story[];
  modules: Module[];
  members: Member[];
  onOpenTask: (taskRef: string) => void;

  // ─── Inline-edit callbacks (forwarded to TasksList) ────────────────────────
  /** All sprints — used by the inline sprint picker on each task row. */
  allSprints?: Sprint[];
  onChangeTaskStatus?: (taskRef: string, status: TaskStatus) => void;
  onChangeTaskAssignee?: (taskRef: string, memberId: string | null) => void;
  onChangeTaskSprint?: (taskRef: string, sprintId: string | null) => void;

  // ─── Row menu callbacks (3-dot) ────────────────────────────────────────────
  onDuplicateTask?: (taskRef: string) => void;
  onCloneTask?: (taskRef: string) => void;
  onCopyTaskRef?: (taskRef: string) => void;
  onDeleteTask?: (taskRef: string) => void;
};

/**
 * Detalhes do sprint focado — apenas a lista de tasks.
 *
 * Saúde do sprint (Alpha alerts, Vitais, Burndown, Capacity) mora na
 * `SprintRibbon` sticky, que cobre todas as tabs do projeto.
 */
export function SprintDetail({
  sprint,
  tasks,
  stories,
  modules,
  members,
  onOpenTask,
  allSprints,
  onChangeTaskStatus,
  onChangeTaskAssignee,
  onChangeTaskSprint,
  onDuplicateTask,
  onCloneTask,
  onCopyTaskRef,
  onDeleteTask,
}: Props) {
  const own = useMemo(
    () => tasksOfSprint(sprint.id, tasks),
    [sprint.id, tasks],
  );

  return (
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
        onDuplicate={onDuplicateTask}
        onClone={onCloneTask}
        onCopyRef={onCopyTaskRef}
        onDelete={onDeleteTask}
      />
    </section>
  );
}
