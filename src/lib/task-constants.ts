// ─── Statuses ─────────────────────────────────────────────

export const TASK_STATUSES = [
  "backlog", "todo", "in_progress", "blocked", "review",
  "done",
] as const;

export type TaskStatus = (typeof TASK_STATUSES)[number];

export const STATUS_LABELS: Record<string, string> = {
  draft: "Rascunho",
  backlog: "Backlog",
  todo: "To Do",
  in_progress: "In Progress",
  blocked: "Blocked",
  review: "Review",
  done: "Done",
};

// Color palettes moved to @/lib/status-chips → use StatusChip component instead.

// ─── Types ────────────────────────────────────────────────

export const TASK_TYPES = [
  "setup", "feature", "component", "seed",
  "bugfix", "refactor", "management",
] as const;

export type TaskType = (typeof TASK_TYPES)[number];

export const TYPE_LABELS: Record<string, string> = {
  setup: "Setup",
  feature: "Feature",
  component: "Componente",
  seed: "Seed",
  bugfix: "Bugfix",
  refactor: "Refactor",
  management: "Gestao",
};

// ─── Scope & Complexity ───────────────────────────────────

export const SCOPES = ["micro", "small", "medium", "large"] as const;
export const COMPLEXITIES = ["trivial", "low", "medium", "high"] as const;

// ─── Helpers ──────────────────────────────────────────────

export function fmtDate(d: string | null) {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("pt-BR", { day: "2-digit", month: "short" });
}

export function isOverdue(d: string | null, status: string) {
  if (!d || status === "done") return false;
  return new Date(d) < new Date();
}
