import { db } from "@/lib/db";
import { NextRequest, NextResponse } from "next/server";
import { canTransition } from "@/lib/task-status";
import { getUser, requireProjectMemberApi } from "@/lib/dal";

const TASK_SELECT = `
  *,
  project:Project(name),
  sprint:Sprint(name),
  assignments:TaskAssignment(*, member:Member(id, name)),
  iterations:TaskIteration(id, number, type, trigger, resultSummary, success, startedAt, completedAt)
`;

async function fetchTask(id: string) {
  const supabase = db();
  const { data: task, error } = await supabase
    .from("Task")
    .select(TASK_SELECT)
    .eq("id", id)
    .single();
  if (error && error.code !== "PGRST116") return null;
  if (!task) return null;

  // Sort iterations desc and add _count
  const iterations = (task as any).iterations ?? [];
  iterations.sort((a: any, b: any) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime());
  return { ...task, iterations, _count: { iterations: iterations.length } };
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getUser();
  if (!user) return new NextResponse("Unauthorized", { status: 401 });

  const { id } = await params;
  const task = await fetchTask(id);
  if (!task) {
    return NextResponse.json({ error: "Task not found" }, { status: 404 });
  }
  return NextResponse.json(task);
}

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const { assigneeIds, ...data } = await req.json();
  const supabase = db();

  const { data: current } = await supabase
    .from("Task")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (!current) {
    return NextResponse.json({ error: "Task not found" }, { status: 404 });
  }

  const denied = await requireProjectMemberApi(current.projectId);
  if (denied) return denied;

  // Validate status transition
  if (data.status && data.status !== current.status) {
    if (!canTransition(current.status, data.status)) {
      return NextResponse.json(
        { error: `Invalid status transition: ${current.status} → ${data.status}` },
        { status: 400 }
      );
    }
  }

  // Handle assignment updates
  if (assigneeIds !== undefined) {
    await supabase.from("TaskAssignment").delete().eq("taskId", id);
    if (assigneeIds.length > 0) {
      await supabase
        .from("TaskAssignment")
        .insert(assigneeIds.map((a: { memberId?: string }) => ({ id: crypto.randomUUID(), taskId: id, ...a })));
    }
  }

  await supabase.from("Task").update(data).eq("id", id);
  const task = await fetchTask(id);

  return NextResponse.json(task);
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const supabase = db();

  const { data: current } = await supabase
    .from("Task")
    .select("projectId")
    .eq("id", id)
    .maybeSingle();
  if (!current) {
    return NextResponse.json({ error: "Task not found" }, { status: 404 });
  }

  const denied = await requireProjectMemberApi(current.projectId);
  if (denied) return denied;

  const { error } = await supabase.from("Task").delete().eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
