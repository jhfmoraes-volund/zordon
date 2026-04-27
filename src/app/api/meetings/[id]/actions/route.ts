import { db } from "@/lib/db";
import { NextRequest, NextResponse } from "next/server";
import { requireMinLevelApi, getCurrentMember } from "@/lib/dal";
import { MANAGER } from "@/lib/roles";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const denied = await requireMinLevelApi(MANAGER);
  if (denied) return denied;

  const me = await getCurrentMember();
  if (!me) return NextResponse.json({ error: "No member" }, { status: 401 });

  const { id } = await params;
  const body = await req.json();

  const { data: action, error } = await db()
    .from("Todo")
    .insert({
      id: crypto.randomUUID(),
      meetingId: id,
      source: "meeting",
      description: body.description,
      assigneeId: body.assigneeId,
      createdById: me.id,
      dueDate: body.dueDate ? new Date(body.dueDate).toISOString() : null,
      status: "todo",
      sourceReviewId: body.sourceReviewId || null,
      updatedAt: new Date().toISOString(),
    })
    .select("*, assignee:Member!Todo_assigneeId_fkey(id, name)")
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json(action, { status: 201 });
}
