export const TASK_STATUSES = [
  "backlog",
  "todo",
  "in_progress",
  "review",
  "done",
] as const;

export type TaskStatus = (typeof TASK_STATUSES)[number];

export const VALID_TRANSITIONS: Record<TaskStatus, TaskStatus[]> = {
  backlog: ["todo"],
  todo: ["in_progress", "backlog"],
  in_progress: ["review", "todo"],
  review: ["done", "in_progress"],
  done: [],
};

export function canTransition(from: string, to: string): boolean {
  const allowed = VALID_TRANSITIONS[from as TaskStatus];
  if (!allowed) return false;
  return allowed.includes(to as TaskStatus);
}

export const STATUS_LABELS: Record<TaskStatus, string> = {
  backlog: "Backlog",
  todo: "To Do",
  in_progress: "In Progress",
  review: "Review",
  done: "Done",
};
