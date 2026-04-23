import { db } from "@/lib/db";
import { NextRequest, NextResponse } from "next/server";
import { requireMinLevelApi } from "@/lib/dal";
import { MANAGER } from "@/lib/roles";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const denied = await requireMinLevelApi(MANAGER);
  if (denied) return denied;

  const { id } = await params;
  const body = await req.json();

  const { data: action, error } = await db()
    .from("MeetingActionItem")
    .insert({
      id: crypto.randomUUID(),
      meetingId: id,
      description: body.description,
      assigneeId: body.assigneeId,
      dueDate: body.dueDate ? new Date(body.dueDate).toISOString() : null,
      status: "todo",
      sourceReviewId: body.sourceReviewId || null,
      updatedAt: new Date().toISOString(),
    })
    .select("*, assignee:Member!MeetingActionItem_assigneeId_fkey(id, name)")
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json(action, { status: 201 });
}
