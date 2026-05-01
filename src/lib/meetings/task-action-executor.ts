import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";

type Supabase = SupabaseClient<Database>;
type ActionRow = Database["public"]["Tables"]["MeetingTaskAction"]["Row"];
type TaskUpdate = Database["public"]["Tables"]["Task"]["Update"];

type ApplyResult = {
  applied: number;
  failed: number;
  skipped: number;
  details: Array<{ id: string; type: string; status: "applied" | "failed" | "skipped"; error?: string }>;
};

const ORDER: Record<ActionRow["type"], number> = {
  create: 0,
  update: 1,
  review: 2,
  move: 3,
  delete: 4,
};

export async function applyApprovedActions(
  supabase: Supabase,
  meetingId: string
): Promise<ApplyResult> {
  const { data: actions, error } = await supabase
    .from("MeetingTaskAction")
    .select("*")
    .eq("meetingId", meetingId)
    .eq("decision", "approved")
    .eq("execution", "pending");

  if (error) throw new Error(`Failed to load actions: ${error.message}`);

  const sorted = (actions ?? []).slice().sort((a, b) => ORDER[a.type] - ORDER[b.type]);

  const result: ApplyResult = { applied: 0, failed: 0, skipped: 0, details: [] };

  for (const action of sorted) {
    try {
      switch (action.type) {
        case "create":
          await applyCreate(supabase, action);
          break;
        case "update":
          await applyUpdate(supabase, action);
          break;
        case "delete":
          await applyDelete(supabase, action);
          break;
        case "move":
          await applyMove(supabase, action);
          break;
        case "review":
          // REVIEW não modifica a Task — só fica registrado na reunião.
          await markExecuted(supabase, action.id, "skipped");
          result.skipped++;
          result.details.push({ id: action.id, type: action.type, status: "skipped" });
          continue;
      }
      await markExecuted(supabase, action.id, "applied");
      result.applied++;
      result.details.push({ id: action.id, type: action.type, status: "applied" });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      await markFailed(supabase, action.id, msg);
      result.failed++;
      result.details.push({ id: action.id, type: action.type, status: "failed", error: msg });
    }
  }

  return result;
}

// ─── Per-type apply ──────────────────────────────────────

async function applyCreate(supabase: Supabase, action: ActionRow) {
  const p = (action.payload ?? {}) as Record<string, unknown>;

  const { data: reference, error: rpcErr } = await supabase.rpc("next_task_reference");
  if (rpcErr || !reference) {
    throw new Error(`Failed to get next task reference: ${rpcErr?.message ?? "no value"}`);
  }

  const taskId = crypto.randomUUID();
  const { error: insErr } = await supabase.from("Task").insert({
    id: taskId,
    reference: reference as string,
    title: (p.title as string) ?? "Nova task",
    description: (p.description as string) ?? null,
    status: (p.status as string) ?? "todo",
    type: (p.type as string) ?? "feature",
    scope: (p.scope as string) ?? "small",
    complexity: (p.complexity as string) ?? "medium",
    priority: (p.priority as number) ?? 0,
    billable: (p.billable as boolean) ?? true,
    functionPoints: (p.functionPoints as number | null) ?? null,
    notes: (p.notes as string) ?? null,
    dueDate: (p.dueDate as string) ?? null,
    projectId: action.projectId,
    sprintId: (p.sprintId as string | null) ?? null,
    createdById: action.decidedById,
    createdByAgent: action.source === "ai",
    updatedAt: new Date().toISOString(),
  });
  if (insErr) throw new Error(`Insert task failed: ${insErr.message}`);

  // Assignments (se vierem)
  const assigneeIds = Array.isArray(p.assigneeIds) ? (p.assigneeIds as string[]) : [];
  if (assigneeIds.length > 0) {
    const { error: aErr } = await supabase.from("TaskAssignment").insert(
      assigneeIds.map((memberId) => ({
        id: crypto.randomUUID(),
        taskId,
        memberId,
      }))
    );
    if (aErr) throw new Error(`Assignments failed: ${aErr.message}`);
  }

  // Linka taskId no action pra rastreamento
  await supabase
    .from("MeetingTaskAction")
    .update({ taskId })
    .eq("id", action.id);
}

async function applyUpdate(supabase: Supabase, action: ActionRow) {
  if (!action.taskId) throw new Error("update requires taskId");
  const p = (action.payload ?? {}) as Record<string, unknown>;

  const allowed = [
    "title", "description", "status", "type", "scope", "complexity",
    "priority", "billable", "functionPoints",
    "notes", "dueDate",
  ] as const;
  const patch: TaskUpdate = { updatedAt: new Date().toISOString() };
  for (const k of allowed) {
    if (k in p) (patch as Record<string, unknown>)[k] = p[k];
  }

  const { error } = await supabase.from("Task").update(patch).eq("id", action.taskId);
  if (error) throw new Error(`Update task failed: ${error.message}`);

  // Assignments — se vierem, substitui o set
  if (Array.isArray(p.assigneeIds)) {
    const ids = p.assigneeIds as string[];
    const { error: dErr } = await supabase
      .from("TaskAssignment")
      .delete()
      .eq("taskId", action.taskId);
    if (dErr) throw new Error(`Clear assignments failed: ${dErr.message}`);

    if (ids.length > 0) {
      const { error: iErr } = await supabase.from("TaskAssignment").insert(
        ids.map((memberId) => ({
          id: crypto.randomUUID(),
          taskId: action.taskId!,
          memberId,
        }))
      );
      if (iErr) throw new Error(`Set assignments failed: ${iErr.message}`);
    }
  }
}

async function applyDelete(supabase: Supabase, action: ActionRow) {
  if (!action.taskId) throw new Error("delete requires taskId");
  const { error } = await supabase
    .from("Task")
    .update({ sprintId: null, status: "backlog", updatedAt: new Date().toISOString() })
    .eq("id", action.taskId);
  if (error) throw new Error(`Remove from sprint failed: ${error.message}`);
}

async function applyMove(supabase: Supabase, action: ActionRow) {
  if (!action.taskId) throw new Error("move requires taskId");
  if (!action.targetSprintId) throw new Error("move requires targetSprintId");
  const { error } = await supabase
    .from("Task")
    .update({ sprintId: action.targetSprintId, updatedAt: new Date().toISOString() })
    .eq("id", action.taskId);
  if (error) throw new Error(`Move task failed: ${error.message}`);
}

// ─── Helpers ─────────────────────────────────────────────

async function markExecuted(
  supabase: Supabase,
  id: string,
  execution: "applied" | "skipped"
) {
  await supabase
    .from("MeetingTaskAction")
    .update({
      execution,
      appliedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    })
    .eq("id", id);
}

async function markFailed(supabase: Supabase, id: string, errorMessage: string) {
  await supabase
    .from("MeetingTaskAction")
    .update({
      execution: "failed",
      errorMessage,
      updatedAt: new Date().toISOString(),
    })
    .eq("id", id);
}
