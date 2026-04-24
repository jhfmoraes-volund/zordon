// ─── Statuses ─────────────────────────────────────────────

export const TASK_STATUSES = [
  "backlog", "todo", "in_progress", "review",
  "done",
] as const;

export type TaskStatus = (typeof TASK_STATUSES)[number];

export const STATUS_LABELS: Record<string, string> = {
  draft: "Rascunho",
  backlog: "Backlog",
  todo: "To Do",
  in_progress: "In Progress",
  review: "Review",
  done: "Done",
};

export const STATUS_COLORS: Record<string, string> = {
  draft: "bg-amber-50 text-amber-700 border border-amber-200",
  backlog: "bg-gray-100 text-gray-700",
  todo: "bg-blue-100 text-blue-700",
  in_progress: "bg-yellow-100 text-yellow-700",
  review: "bg-purple-100 text-purple-700",
  done: "bg-green-100 text-green-700",
};

// Dark-theme variants used in board cards
export const STATUS_COLORS_DARK: Record<string, string> = {
  draft: "bg-amber-500/15 text-amber-400 border border-amber-500/30",
  backlog: "bg-muted text-muted-foreground",
  todo: "bg-blue-500/20 text-blue-400",
  in_progress: "bg-yellow-500/20 text-yellow-400",
  review: "bg-purple-500/20 text-purple-400",
  done: "bg-green-500/20 text-green-400",
};

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

export const TYPE_COLORS: Record<string, string> = {
  setup: "bg-purple-100 text-purple-700",
  feature: "bg-blue-100 text-blue-700",
  component: "bg-teal-100 text-teal-700",
  seed: "bg-amber-100 text-amber-700",
  bugfix: "bg-red-100 text-red-700",
  refactor: "bg-gray-100 text-gray-700",
  management: "bg-pink-100 text-pink-700",
};

// Dark-theme variants used in board cards
export const TYPE_COLORS_DARK: Record<string, string> = {
  setup: "bg-purple-500/20 text-purple-400",
  feature: "bg-blue-500/20 text-blue-400",
  component: "bg-teal-500/20 text-teal-400",
  seed: "bg-amber-500/20 text-amber-400",
  bugfix: "bg-red-500/20 text-red-400",
  refactor: "bg-muted text-muted-foreground",
  management: "bg-pink-500/20 text-pink-400",
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
