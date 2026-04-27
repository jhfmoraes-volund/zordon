import { db } from "@/lib/db";
import { NextRequest, NextResponse } from "next/server";
import { requireMinLevelApi, getCurrentMember } from "@/lib/dal";
import { MANAGER } from "@/lib/roles";
import type { Database } from "@/lib/supabase/database.types";

type Update = Database["public"]["Tables"]["MeetingTaskAction"]["Update"];

const SELECT = `
  *,
  task:Task(id, reference, title, status, scope, complexity, type, priority,
            sprintId, projectId, assignments:TaskAssignment(*, member:Member(id, name))),
  targetSprint:Sprint!MeetingTaskAction_targetSprintId_fkey(id, name),
  decidedBy:Member!MeetingTaskAction_decidedById_fkey(id, name)
`;

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; actionId: string }> }
) {
  const denied = await requireMinLevelApi(MANAGER);
  if (denied) return denied;

  const me = await getCurrentMember();
  if (!me) return NextResponse.json({ error: "No member" }, { status: 401 });

  const { actionId } = await params;
  const body = await req.json();

  const editable: Update = { updatedAt: new Date().toISOString() };
  if ("payload" in body) editable.payload = body.payload as Update["payload"];
  if ("targetSprintId" in body) editable.targetSprintId = body.targetSprintId;
  if ("notes" in body) editable.notes = body.notes;
  if ("reviewReasons" in body) editable.reviewReasons = body.reviewReasons;
  if ("reviewNote" in body) editable.reviewNote = body.reviewNote;
  if ("wasEdited" in body) editable.wasEdited = body.wasEdited;

  if (body.decision && ["pending", "approved", "rejected"].includes(body.decision)) {
    editable.decision = body.decision;
    if (body.decision === "pending") {
      editable.decidedAt = null;
      editable.decidedById = null;
    } else {
      editable.decidedAt = new Date().toISOString();
      editable.decidedById = me.id;
    }
  }

  const { data, error } = await db()
    .from("MeetingTaskAction")
    .update(editable)
    .eq("id", actionId)
    .select(SELECT)
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; actionId: string }> }
) {
  const denied = await requireMinLevelApi(MANAGER);
  if (denied) return denied;

  const { actionId } = await params;
  const { error } = await db()
    .from("MeetingTaskAction")
    .delete()
    .eq("id", actionId);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
