import "server-only";
import { db } from "@/lib/db";
import type { Database } from "@/lib/supabase/database.types";

type Tables = Database["public"]["Tables"];

export type ForgeRunRow = Tables["ForgeRun"]["Row"];
export type ForgeRunInsert = Tables["ForgeRun"]["Insert"];
export type ForgeRunUpdate = Tables["ForgeRun"]["Update"];

export type ForgeTaskRow = Tables["ForgeTask"]["Row"];
export type ForgeTaskInsert = Tables["ForgeTask"]["Insert"];
export type ForgeTaskUpdate = Tables["ForgeTask"]["Update"];

export type ForgeRunStatus = "queued" | "running" | "done" | "error" | "aborted" | "paused-pivot";

export type ForgeTaskStatus =
  | "queued"
  | "idle"
  | "spawning"
  | "thinking"
  | "tool"
  | "streaming"
  | "done"
  | "error"
  | "todo"
  | "doing"
  | "blocked";

// ─── CRUD: ForgeRun ───────────────────────────────────────────────────────────

/**
 * Create a new ForgeRun
 */
export async function createRun(
  input: Omit<ForgeRunInsert, "id" | "createdAt">,
): Promise<ForgeRunRow> {
  const { data, error } = await db()
    .from("ForgeRun")
    .insert(input)
    .select("*")
    .single();
  if (error) throw error;
  return data;
}

/**
 * Get a ForgeRun by ID
 */
export async function getRun(runId: string): Promise<ForgeRunRow | null> {
  const { data, error } = await db()
    .from("ForgeRun")
    .select("*")
    .eq("id", runId)
    .maybeSingle();
  if (error) throw error;
  return data;
}

/**
 * Get a ForgeRun with all its tasks
 */
export async function getRunWithTasks(
  runId: string,
): Promise<(ForgeRunRow & { tasks: ForgeTaskRow[] }) | null> {
  const { data: run, error: runError } = await db()
    .from("ForgeRun")
    .select("*")
    .eq("id", runId)
    .maybeSingle();
  if (runError) throw runError;
  if (!run) return null;

  const { data: tasks, error: tasksError } = await db()
    .from("ForgeTask")
    .select("*")
    .eq("runId", runId)
    .order("ord", { ascending: true });
  if (tasksError) throw tasksError;

  return {
    ...run,
    tasks: tasks ?? [],
  };
}

/**
 * Update ForgeRun status
 */
export async function updateRunStatus(
  runId: string,
  status: ForgeRunStatus,
  opts?: {
    progress?: number;
    startedAt?: string;
    endedAt?: string;
  },
): Promise<ForgeRunRow> {
  const patch: ForgeRunUpdate = {
    status,
  };

  if (opts?.progress !== undefined) {
    patch.progress = opts.progress;
  }

  if (opts?.startedAt) {
    patch.startedAt = opts.startedAt;
  }

  if (opts?.endedAt) {
    patch.endedAt = opts.endedAt;
  }

  const { data, error } = await db()
    .from("ForgeRun")
    .update(patch)
    .eq("id", runId)
    .select("*")
    .single();
  if (error) throw error;
  return data;
}

// ─── CRUD: ForgeTask ──────────────────────────────────────────────────────────

/**
 * Create a new ForgeTask
 */
export async function createTask(
  input: Omit<ForgeTaskInsert, "id">,
): Promise<ForgeTaskRow> {
  const { data, error } = await db()
    .from("ForgeTask")
    .insert(input)
    .select("*")
    .single();
  if (error) throw error;
  return data;
}

/**
 * Bulk create ForgeTask records
 */
export async function createTasks(
  inputs: Omit<ForgeTaskInsert, "id">[],
): Promise<ForgeTaskRow[]> {
  const { data, error } = await db()
    .from("ForgeTask")
    .insert(inputs)
    .select("*");
  if (error) throw error;
  return data ?? [];
}

/**
 * Get a ForgeTask by ID
 */
export async function getTask(taskId: string): Promise<ForgeTaskRow | null> {
  const { data, error } = await db()
    .from("ForgeTask")
    .select("*")
    .eq("id", taskId)
    .maybeSingle();
  if (error) throw error;
  return data;
}

/**
 * List all tasks for a run
 */
export async function listTasksForRun(runId: string): Promise<ForgeTaskRow[]> {
  const { data, error } = await db()
    .from("ForgeTask")
    .select("*")
    .eq("runId", runId)
    .order("ord", { ascending: true });
  if (error) throw error;
  return data ?? [];
}

/**
 * Update ForgeTask status and metadata
 */
export async function updateTaskStatus(
  taskId: string,
  status: ForgeTaskStatus,
  opts?: {
    progress?: number;
    currentTool?: string | null;
    startedAt?: string;
    endedAt?: string;
    meta?: Record<string, unknown>;
  },
): Promise<ForgeTaskRow> {
  const patch: ForgeTaskUpdate = {
    status,
  };

  if (opts?.progress !== undefined) {
    patch.progress = opts.progress;
  }

  if (opts?.currentTool !== undefined) {
    patch.currentTool = opts.currentTool;
  }

  if (opts?.startedAt) {
    patch.startedAt = opts.startedAt;
  }

  if (opts?.endedAt) {
    patch.endedAt = opts.endedAt;
  }

  if (opts?.meta) {
    patch.meta = opts.meta as Tables["ForgeTask"]["Update"]["meta"];
  }

  const { data, error } = await db()
    .from("ForgeTask")
    .update(patch)
    .eq("id", taskId)
    .select("*")
    .single();
  if (error) throw error;
  return data;
}

/**
 * Update ForgeTask passes flag (top-level column on ForgeTask).
 */
export async function updateTaskPasses(
  taskId: string,
  passes: boolean,
): Promise<ForgeTaskRow> {
  const { data, error } = await db()
    .from("ForgeTask")
    .update({ passes })
    .eq("id", taskId)
    .select("*")
    .single();
  if (error) throw error;
  return data;
}

/**
 * Update ForgeTask cost data (tokensIn, tokensOut, costUsd)
 */
export async function updateTaskCost(
  taskId: string,
  cost: {
    tokensIn: number;
    tokensOut: number;
    costUsd: number;
  },
): Promise<ForgeTaskRow> {
  const { data, error } = await db()
    .from("ForgeTask")
    .update({
      tokensIn: cost.tokensIn,
      tokensOut: cost.tokensOut,
      costUsd: cost.costUsd,
    })
    .eq("id", taskId)
    .select("*")
    .single();
  if (error) throw error;
  return data;
}

/**
 * Increment task failure count (for pivot detection)
 */
export async function incrementTaskFailureCount(
  taskId: string,
): Promise<ForgeTaskRow> {
  // Fetch current meta
  const task = await getTask(taskId);
  if (!task) throw new Error(`Task ${taskId} not found`);

  const meta = (task.meta as Record<string, unknown>) ?? {};
  const failureCount = ((meta.failureCount as number) ?? 0) + 1;

  const { data, error } = await db()
    .from("ForgeTask")
    .update({
      meta: { ...meta, failureCount },
    })
    .eq("id", taskId)
    .select("*")
    .single();
  if (error) throw error;
  return data;
}

/**
 * Get ready tasks (no unmet dependencies, not yet passed).
 */
export async function getReadyTasks(runId: string): Promise<ForgeTaskRow[]> {
  const tasks = await listTasksForRun(runId);

  const depsOf = (t: ForgeTaskRow) => {
    return Array.isArray(t.dependsOn) ? (t.dependsOn as string[]) : [];
  };

  const passedIds = new Set(tasks.filter((t) => t.passes === true).map((t) => t.id));

  const ready = tasks.filter((task) => {
    if (task.passes === true) return false;
    return depsOf(task).every((depId) => passedIds.has(depId));
  });

  ready.sort((a, b) => a.ord - b.ord);
  return ready;
}
