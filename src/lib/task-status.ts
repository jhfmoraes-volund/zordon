export const TASK_STATUSES = [
  "backlog",
  "todo",
  "in_progress",
  "review",
  "changes_requested",
  "approved",
  "staging",
  "merge_conflict",
  "staging_failed",
  "done",
] as const;

export type TaskStatus = (typeof TASK_STATUSES)[number];

export const VALID_TRANSITIONS: Record<TaskStatus, TaskStatus[]> = {
  backlog: ["todo"],
  todo: ["in_progress", "backlog"],
  in_progress: ["review", "todo"],
  review: ["changes_requested", "approved"],
  changes_requested: ["in_progress"],
  approved: ["staging", "merge_conflict"],
  staging: ["done", "staging_failed"],
  merge_conflict: ["in_progress"],
  staging_failed: ["in_progress"],
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
  changes_requested: "Changes Requested",
  approved: "Approved",
  staging: "Staging",
  merge_conflict: "Merge Conflict",
  staging_failed: "Staging Failed",
  done: "Done",
};
