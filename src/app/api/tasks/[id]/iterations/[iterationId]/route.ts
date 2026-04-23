import { db } from "@/lib/db";
import { NextRequest, NextResponse } from "next/server";
import { requireProjectMemberApi } from "@/lib/dal";

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; iterationId: string }> }
) {
  const { id, iterationId } = await params;
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

  const { data: iteration, error } = await supabase
    .from("TaskIteration")
    .update(data)
    .eq("id", iterationId)
    .select()
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json(iteration);
}
