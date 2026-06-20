import { db } from "@/lib/db";
import { NextRequest, NextResponse } from "next/server";
import { suggestFunctionPoints } from "@/lib/function-points";
import { getCurrentMember, getUser, requireProjectMemberApi } from "@/lib/dal";
import { isGuestActor, maskFPListIfGuest, maskFPIfGuest } from "@/lib/guest-payload";
import { recordTaskCreated } from "@/lib/dal/task-activity-recorder";
import { flattenTagEmbed, type TaskTagEmbedRow } from "@/lib/task-tags";

export async function GET(req: NextRequest) {
  const user = await getUser();
  if (!user) return new NextResponse("Unauthorized", { status: 401 });

  const sprintId = req.nextUrl.searchParams.get("sprintId");
  const projectId = req.nextUrl.searchParams.get("projectId");
  const supabase = db();

  let query = supabase
    .from("Task")
    .select(`
      *,
      project:Project(name),
      sprint:Sprint(name, startDate, endDate),
      assignments:TaskAssignment(*, member:Member(id, name))
    `)
    .neq("status", "draft")
    .is("dismissedAt", null)
    .order("priority", { ascending: false })
    .order("createdAt", { ascending: false });

  if (sprintId) query = query.eq("sprintId", sprintId);
  if (projectId) query = query.eq("projectId", projectId);

  const { data: tasks, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Add _count.iterations via separate query
  const taskIds = (tasks ?? []).map((t) => t.id);
  const iterationCounts: Record<string, number> = {};
  if (taskIds.length > 0) {
    const { data: counts } = await supabase
      .from("TaskIteration")
      .select("taskId")
      .in("taskId", taskIds);
    if (counts) {
      for (const c of counts) {
        iterationCounts[c.taskId] = (iterationCounts[c.taskId] ?? 0) + 1;
      }
    }
  }

  const result = (tasks ?? []).map((t) => ({
    ...t,
    _count: { iterations: iterationCounts[t.id] ?? 0 },
  }));

  const guest = await isGuestActor();
  return NextResponse.json(maskFPListIfGuest(result, guest));
}

export async function POST(req: NextRequest) {
  const { assigneeIds, ...data } = await req.json();

  if (!data.projectId) {
    return NextResponse.json({ error: "projectId required" }, { status: 400 });
  }
  const denied = await requireProjectMemberApi(data.projectId);
  if (denied) return denied;

  const currentMember = await getCurrentMember();
  data.createdById = currentMember?.id ?? null;
  data.createdByAgent = false;

  const supabase = db();

  // Auto-suggest PFV if not provided
  if (data.functionPoints === undefined || data.functionPoints === null) {
    data.functionPoints = suggestFunctionPoints(
      data.scope || "small",
      data.complexity || "medium"
    );
  }

  // Auto-generate reference using RPC, retry on collision
  for (let attempt = 0; attempt < 5; attempt++) {
    if (!data.reference || attempt > 0) {
      const { data: ref } = await supabase.rpc("next_task_reference", {
        p_project_id: data.projectId,
      });
      data.reference = ref;
    }

    const { data: task, error } = await supabase
      .from("Task")
      .insert({ id: crypto.randomUUID(), updatedAt: new Date().toISOString(), ...data })
      .select("*, project:Project(name)")
      .single();

    if (error) {
      // 23505 = unique_violation in Postgres
      if (error.code === "23505" && error.message?.includes("reference")) {
        continue; // retry with new reference
      }
      console.error("[POST /api/tasks] create failed", error);
      return NextResponse.json(
        { error: error.message || "Failed to create task" },
        { status: 500 }
      );
    }

    // Create assignments
    if (assigneeIds?.length) {
      await supabase
        .from("TaskAssignment")
        .insert(assigneeIds.map((a: { memberId?: string }) => ({ id: crypto.randomUUID(), taskId: task.id, ...a })));
    }

    // Re-fetch with the same shape RawTask expects on the client (assignments
    // + tags). Tags are flattened to canonical TaskTag[] at the boundary.
    const { data: full } = await supabase
      .from("Task")
      .select(
        "*, project:Project(name), assignments:TaskAssignment(*, member:Member(id, name)), tags:TaskTagAssignment(TaskTag(id, projectId, name, tone))",
      )
      .eq("id", task.id)
      .single();

    const result = full
      ? {
          ...full,
          tags: flattenTagEmbed(
            (full as typeof full & { tags?: TaskTagEmbedRow[] }).tags,
          ),
        }
      : full;

    recordTaskCreated(task.id, {
      title: task.title,
      reference: task.reference ?? null,
    }).catch((e) =>
      console.error("[task-activity] recordTaskCreated failed", e),
    );

    const guest = await isGuestActor();
    return NextResponse.json(
      result ? maskFPIfGuest(result, guest) : result,
      { status: 201 },
    );
  }

  return NextResponse.json(
    { error: "Could not generate unique task reference" },
    { status: 500 }
  );
}
