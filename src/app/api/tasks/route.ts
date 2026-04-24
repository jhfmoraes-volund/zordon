import { db } from "@/lib/db";
import { NextRequest, NextResponse } from "next/server";
import { suggestFunctionPoints } from "@/lib/function-points";
import { getUser, requireProjectMemberApi } from "@/lib/dal";

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
      sprint:Sprint(name),
      assignments:TaskAssignment(*, member:Member(id, name))
    `)
    .neq("status", "draft")
    .order("priority", { ascending: false })
    .order("createdAt", { ascending: false });

  if (sprintId) query = query.eq("sprintId", sprintId);
  if (projectId) query = query.eq("projectId", projectId);

  const { data: tasks, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Add _count.iterations via separate query
  const taskIds = (tasks ?? []).map((t) => t.id);
  let iterationCounts: Record<string, number> = {};
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

  return NextResponse.json(result);
}

export async function POST(req: NextRequest) {
  const { assigneeIds, ...data } = await req.json();

  if (!data.projectId) {
    return NextResponse.json({ error: "projectId required" }, { status: 400 });
  }
  const denied = await requireProjectMemberApi(data.projectId);
  if (denied) return denied;

  const supabase = db();

  // Auto-suggest FP if not provided
  if (data.functionPoints === undefined || data.functionPoints === null) {
    data.functionPoints = suggestFunctionPoints(
      data.scope || "small",
      data.complexity || "medium"
    );
  }

  // Auto-generate reference using RPC, retry on collision
  for (let attempt = 0; attempt < 5; attempt++) {
    if (!data.reference || attempt > 0) {
      const { data: ref } = await supabase.rpc("next_task_reference");
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

    // Re-fetch with assignments
    const { data: full } = await supabase
      .from("Task")
      .select("*, project:Project(name), assignments:TaskAssignment(*, member:Member(id, name))")
      .eq("id", task.id)
      .single();

    return NextResponse.json(full, { status: 201 });
  }

  return NextResponse.json(
    { error: "Could not generate unique task reference" },
    { status: 500 }
  );
}
