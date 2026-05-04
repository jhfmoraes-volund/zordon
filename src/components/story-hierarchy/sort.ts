// Sort utilities for Task lists. Shared by TasksList (project page) and
// MeetingTaskList (meetings page) so behavior stays consistent.

import type { Member, Story, Task, TaskStatus } from "./types";

type SprintLite = {
  id: string;
  name: string;
};

export type SortKey =
  | "ref"
  | "title"
  | "story"
  | "sprint"
  | "status"
  | "fp"
  | "assignee";

export type SortDir = "asc" | "desc";

// Display order — used as the rank for status sort. Matches the status pipeline
// (draft → backlog → todo → in_progress → review → done), which is more useful
// than alphabetical when sorting "by status".
export const STATUS_RANK: Record<TaskStatus, number> = {
  draft: 0,
  backlog: 1,
  todo: 2,
  in_progress: 3,
  review: 4,
  done: 5,
};

export type SortContext = {
  stories: Story[];
  sprints?: SprintLite[];
  members: Member[];
};

export function compareTasks(
  a: Task,
  b: Task,
  key: SortKey,
  ctx: SortContext,
): number {
  switch (key) {
    case "ref":
      return a.reference.localeCompare(b.reference, undefined, { numeric: true });
    case "title":
      return a.title.localeCompare(b.title);
    case "story": {
      const aStory = ctx.stories.find((s) => s.reference === a.userStoryRef);
      const bStory = ctx.stories.find((s) => s.reference === b.userStoryRef);
      // Sem story → fim (asc); o caller inverte pra desc.
      if (!aStory && !bStory) return 0;
      if (!aStory) return 1;
      if (!bStory) return -1;
      return aStory.reference.localeCompare(bStory.reference, undefined, { numeric: true });
    }
    case "sprint": {
      const aS = ctx.sprints?.find((s) => s.id === a.sprintId);
      const bS = ctx.sprints?.find((s) => s.id === b.sprintId);
      if (!aS && !bS) return 0;
      if (!aS) return 1;
      if (!bS) return -1;
      return aS.name.localeCompare(bS.name, undefined, { numeric: true });
    }
    case "status":
      return STATUS_RANK[a.status] - STATUS_RANK[b.status];
    case "fp":
      return a.functionPoints - b.functionPoints;
    case "assignee": {
      const aId = a.assigneeIds[0] ?? null;
      const bId = b.assigneeIds[0] ?? null;
      if (!aId && !bId) return 0;
      if (!aId) return 1;
      if (!bId) return -1;
      const aName = ctx.members.find((m) => m.id === aId)?.name ?? "";
      const bName = ctx.members.find((m) => m.id === bId)?.name ?? "";
      return aName.localeCompare(bName);
    }
  }
}

export function sortTasks(
  tasks: Task[],
  key: SortKey | null,
  dir: SortDir,
  ctx: SortContext,
): Task[] {
  if (!key) return tasks;
  const sign = dir === "asc" ? 1 : -1;
  // Stable sort: copy first.
  return [...tasks].sort((a, b) => sign * compareTasks(a, b, key, ctx));
}
