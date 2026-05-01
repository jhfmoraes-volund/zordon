import { db } from "@/lib/db";
import { NextRequest, NextResponse } from "next/server";
import { canEditTasks, getUser } from "@/lib/dal";

// ─── Body shape ──────────────────────────────────────────────
//
// PATCH /api/tasks/bulk
// {
//   taskIds: string[],
//   action: "update" | "delete",
//   patch?: { status?, sprintId?, assigneeId? }   // only when action = "update"
// }
//
// `assigneeId` semantics:
//   - string  → replace all assignments with this single member
//   - null    → unassign (delete all assignments)
//   - missing → leave assignments untouched

type BulkBody = {
  taskIds?: unknown;
  action?: unknown;
  patch?: {
    status?: unknown;
    sprintId?: unknown;
    assigneeId?: unknown;
  };
};

export async function PATCH(req: NextRequest) {
  const user = await getUser();
  if (!user) return new NextResponse("Unauthorized", { status: 401 });

  const body = (await req.json()) as BulkBody;

  if (!Array.isArray(body.taskIds) || body.taskIds.length === 0) {
    return NextResponse.json({ error: "taskIds required" }, { status: 400 });
  }
  const taskIds = body.taskIds.filter((x): x is string => typeof x === "string");
  if (taskIds.length === 0) {
    return NextResponse.json({ error: "taskIds must be strings" }, { status: 400 });
  }
  if (taskIds.length > 100) {
    return NextResponse.json({ error: "Max 100 tasks per request" }, { status: 400 });
  }

  if (body.action !== "update" && body.action !== "delete") {
    return NextResponse.json({ error: "action must be update | delete" }, { status: 400 });
  }

  const supabase = db();

  // Fetch task → projectId mapping. Skip RLS via service_role; we gate
  // permission per-project below.
  const { data: rows, error: fetchErr } = await supabase
    .from("Task")
    .select("id, projectId")
    .in("id", taskIds);
  if (fetchErr) {
    return NextResponse.json({ error: fetchErr.message }, { status: 500 });
  }
  if (!rows || rows.length === 0) {
    return NextResponse.json({ error: "No matching tasks" }, { status: 404 });
  }

  // Group ids by project so we can permission-check once per project.
  const byProject = new Map<string, string[]>();
  for (const r of rows) {
    const arr = byProject.get(r.projectId) ?? [];
    arr.push(r.id);
    byProject.set(r.projectId, arr);
  }

  // All projects must pass the edit-tasks gate. If any fails, refuse the
  // entire batch — partial edits are confusing for the user.
  for (const projectId of byProject.keys()) {
    const ok = await canEditTasks(projectId);
    if (!ok) {
      return NextResponse.json(
        { error: "Forbidden — cannot edit tasks in one of the involved projects" },
        { status: 403 },
      );
    }
  }

  const allowedIds = rows.map((r) => r.id);

  if (body.action === "delete") {
    const { error } = await supabase.from("Task").delete().in("id", allowedIds);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true, count: allowedIds.length });
  }

  // ─── action = "update" ─────────────────────────────────────
  const patch = body.patch ?? {};
  const taskUpdate: {
    status?: string;
    sprintId?: string | null;
    updatedAt?: string;
  } = {};

  if (typeof patch.status === "string") taskUpdate.status = patch.status;
  if (patch.sprintId === null || typeof patch.sprintId === "string") {
    taskUpdate.sprintId = patch.sprintId as string | null;
  }

  const hasAssigneeChange =
    patch.assigneeId === null || typeof patch.assigneeId === "string";
  const hasTaskUpdate = "status" in taskUpdate || "sprintId" in taskUpdate;

  if (!hasTaskUpdate && !hasAssigneeChange) {
    return NextResponse.json({ error: "patch is empty" }, { status: 400 });
  }

  if (hasTaskUpdate) {
    taskUpdate.updatedAt = new Date().toISOString();
    const { error } = await supabase
      .from("Task")
      .update(taskUpdate)
      .in("id", allowedIds);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  }

  if (hasAssigneeChange) {
    const { error: delErr } = await supabase
      .from("TaskAssignment")
      .delete()
      .in("taskId", allowedIds);
    if (delErr) {
      return NextResponse.json({ error: delErr.message }, { status: 500 });
    }
    if (typeof patch.assigneeId === "string") {
      const inserts = allowedIds.map((taskId) => ({
        id: crypto.randomUUID(),
        taskId,
        memberId: patch.assigneeId as string,
      }));
      const { error: insErr } = await supabase
        .from("TaskAssignment")
        .insert(inserts);
      if (insErr) {
        return NextResponse.json({ error: insErr.message }, { status: 500 });
      }
    }
  }

  return NextResponse.json({ ok: true, count: allowedIds.length });
}
