// Pure derivations from the canonical state — never mutate, never fetch.
// Mirrors the SQL view `user_story_overview` defined in the plan V2 (4.7).

import type { ComputedStatus, Story, Task } from "./types";

export function tasksOfStory(story: Story, tasks: Task[]): Task[] {
  return tasks.filter((t) => t.userStoryRef === story.reference);
}

export function computeStatus(story: Story, tasks: Task[]): ComputedStatus {
  const own = tasksOfStory(story, tasks);
  if (own.length === 0) return "pending";
  const doneCount = own.filter((t) => t.status === "done").length;
  if (doneCount === own.length && story.acValidatedAt) return "done";
  if (doneCount === own.length) return "tasks_complete";
  const anyActive = own.some(
    (t) => t.status === "done" || t.status === "in_progress" || t.status === "review",
  );
  return anyActive ? "in_progress" : "pending";
}

export function fpOfStory(
  story: Story,
  tasks: Task[],
): { total: number; done: number } {
  const own = tasksOfStory(story, tasks);
  return {
    total: own.reduce((acc, t) => acc + t.functionPoints, 0),
    done: own
      .filter((t) => t.status === "done")
      .reduce((acc, t) => acc + t.functionPoints, 0),
  };
}

export function taskCountsOfStory(
  story: Story,
  tasks: Task[],
): { total: number; done: number } {
  const own = tasksOfStory(story, tasks);
  return {
    total: own.length,
    done: own.filter((t) => t.status === "done").length,
  };
}

export function acProgress(items: { checked: boolean }[]): {
  total: number;
  done: number;
} {
  return {
    total: items.length,
    done: items.filter((i) => i.checked).length,
  };
}
