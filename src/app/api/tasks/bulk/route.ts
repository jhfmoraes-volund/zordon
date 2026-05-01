import { db } from "@/lib/db";
import { NextRequest, NextResponse } from "next/server";
import { canEditTasks, getUser } from "@/lib/dal";
import { TASK_TAG_LIMIT } from "@/lib/task-tags";

// ─── Body shape ──────────────────────────────────────────────
//
// PATCH /api/tasks/bulk
// {
//   taskIds: string[],
//   action: "update" | "delete",
//   patch?: {
//     status?, sprintId?, assigneeId?,
//     addTagIds?: string[],     // additive — won't remove existing tags
//     removeTagIds?: string[],  // removes only the listed tags
//   }
// }
//
// `assigneeId` semantics:
//   - string  → replace all assignments with this single member
//   - null    → unassign (delete all assignments)
//   - missing → leave assignments untouched
//
// Tag semantics are intentionally additive/subtractive (not "set"): in bulk,
// users typically want "tag these N tasks as Bug" without nuking other tags.
// `addTagIds` skips tags already assigned (no-op per task) and skips tasks that
// would exceed the 10-tag hard limit (reported via `skipped`).

type BulkBody = {
  taskIds?: unknown;
  action?: unknown;
  patch?: {
    status?: unknown;
    sprintId?: unknown;
    assigneeId?: unknown;
    addTagIds?: unknown;
    removeTagIds?: unknown;
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

  const addTagIds = Array.isArray(patch.addTagIds)
    ? patch.addTagIds.filter((x): x is string => typeof x === "string")
    : [];
  const removeTagIds = Array.isArray(patch.removeTagIds)
    ? patch.removeTagIds.filter((x): x is string => typeof x === "string")
    : [];
  const hasTagChange = addTagIds.length > 0 || removeTagIds.length > 0;

  if (!hasTaskUpdate && !hasAssigneeChange && !hasTagChange) {
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

  // ─── Tag changes ────────────────────────────────────────────
  // Skipped tasks (limit-exceeded) are surfaced so the UI can warn.
  const skippedDueToLimit: string[] = [];

  if (hasTagChange) {
    // Validate tag projects match task projects. Reject up-front if any tag is
    // from a project the user can't edit, or doesn't exist.
    const allTagIds = Array.from(new Set([...addTagIds, ...removeTagIds]));
    if (allTagIds.length > 0) {
      const { data: tagRows, error: tagErr } = await supabase
        .from("TaskTag")
        .select("id, projectId")
        .in("id", allTagIds);
      if (tagErr) {
        return NextResponse.json({ error: tagErr.message }, { status: 500 });
      }
      const foundIds = new Set((tagRows ?? []).map((t) => t.id));
      const missing = allTagIds.filter((id) => !foundIds.has(id));
      if (missing.length > 0) {
        return NextResponse.json(
          { error: "One or more tags not found", missing },
          { status: 400 },
        );
      }
      const tagProjectById = new Map(
        (tagRows ?? []).map((t) => [t.id, t.projectId]),
      );
      // For each task, ensure every tag being applied/removed belongs to that
      // task's project. Cross-project tags are nonsense and silently dangerous.
      for (const r of rows) {
        for (const tagId of allTagIds) {
          if (tagProjectById.get(tagId) !== r.projectId) {
            return NextResponse.json(
              {
                error:
                  "Tag belongs to a different project than one of the tasks",
                tagId,
              },
              { status: 400 },
            );
          }
        }
      }
    }

    if (removeTagIds.length > 0) {
      const { error: rmErr } = await supabase
        .from("TaskTagAssignment")
        .delete()
        .in("taskId", allowedIds)
        .in("tagId", removeTagIds);
      if (rmErr) {
        return NextResponse.json({ error: rmErr.message }, { status: 500 });
      }
    }

    if (addTagIds.length > 0) {
      // Read current assignments for the affected tasks so we can:
      // 1) skip duplicates (would 23505 on the unique pk)
      // 2) skip tasks that would exceed TASK_TAG_LIMIT (the trigger would
      //    abort the whole INSERT — costlier than pre-filtering)
      const { data: currentRows, error: curErr } = await supabase
        .from("TaskTagAssignment")
        .select("taskId, tagId")
        .in("taskId", allowedIds);
      if (curErr) {
        return NextResponse.json({ error: curErr.message }, { status: 500 });
      }
      const currentByTask = new Map<string, Set<string>>();
      for (const r of currentRows ?? []) {
        const set = currentByTask.get(r.taskId) ?? new Set<string>();
        set.add(r.tagId);
        currentByTask.set(r.taskId, set);
      }

      const inserts: { taskId: string; tagId: string }[] = [];
      for (const taskId of allowedIds) {
        const have = currentByTask.get(taskId) ?? new Set<string>();
        const newOnes = addTagIds.filter((id) => !have.has(id));
        if (newOnes.length === 0) continue;
        if (have.size + newOnes.length > TASK_TAG_LIMIT) {
          skippedDueToLimit.push(taskId);
          continue;
        }
        for (const tagId of newOnes) {
          inserts.push({ taskId, tagId });
        }
      }

      if (inserts.length > 0) {
        const { error: addErr } = await supabase
          .from("TaskTagAssignment")
          .insert(inserts);
        if (addErr) {
          return NextResponse.json(
            { error: addErr.message },
            { status: 500 },
          );
        }
      }
    }
  }

  return NextResponse.json({
    ok: true,
    count: allowedIds.length,
    skippedDueToLimit,
  });
}
