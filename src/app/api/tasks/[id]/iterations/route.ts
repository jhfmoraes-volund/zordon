import { db } from "@/lib/db";
import { NextRequest, NextResponse } from "next/server";
import { getUser, requireProjectMemberApi } from "@/lib/dal";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getUser();
  if (!user) return new NextResponse("Unauthorized", { status: 401 });

  const { id } = await params;

  const { data: iterations, error } = await db()
    .from("TaskIteration")
    .select("*")
    .eq("taskId", id)
    .order("number");
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json(iterations);
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const data = await req.json();
  const supabase = db();

  const { data: task } = await supabase
    .from("Task")
    .select("projectId")
    .eq("id", id)
    .maybeSingle();
  if (!task) {
    return NextResponse.json({ error: "Task not found" }, { status: 404 });
  }
  const denied = await requireProjectMemberApi(task.projectId);
  if (denied) return denied;

  // Auto-increment iteration number
  const { data: last } = await supabase
    .from("TaskIteration")
    .select("number")
    .eq("taskId", id)
    .order("number", { ascending: false })
    .limit(1)
    .maybeSingle();
  const nextNumber = (last?.number ?? 0) + 1;

  const { data: iteration, error } = await supabase
    .from("TaskIteration")
    .insert({
      id: crypto.randomUUID(),
      ...data,
      taskId: id,
      number: nextNumber,
    })
    .select()
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Touch task updatedAt
  await supabase
    .from("Task")
    .update({ updatedAt: new Date().toISOString() })
    .eq("id", id);

  return NextResponse.json(iteration, { status: 201 });
}
