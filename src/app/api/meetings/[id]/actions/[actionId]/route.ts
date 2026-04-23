import { db } from "@/lib/db";
import { NextRequest, NextResponse } from "next/server";
import { requireMinLevelApi } from "@/lib/dal";
import { MANAGER } from "@/lib/roles";
import type { Database } from "@/lib/supabase/database.types";

type ActionUpdate = Database["public"]["Tables"]["MeetingActionItem"]["Update"];

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; actionId: string }> }
) {
  const denied = await requireMinLevelApi(MANAGER);
  if (denied) return denied;

  const { actionId } = await params;
  const body = await req.json();

  const data: ActionUpdate = {};
  if (body.status !== undefined) data.status = body.status;
  if (body.description !== undefined) data.description = body.description;
  if (body.assigneeId !== undefined) data.assigneeId = body.assigneeId;
  if (body.dueDate !== undefined) data.dueDate = body.dueDate ? new Date(body.dueDate).toISOString() : null;

  if (body.status === "done") data.resolvedAt = new Date().toISOString();
  if (body.status && body.status !== "done") data.resolvedAt = null;

  const supabase = db();
  const { data: action, error } = await supabase
    .from("MeetingActionItem")
    .update(data)
    .eq("id", actionId)
    .select("*, assignee:Member!MeetingActionItem_assigneeId_fkey(id, name)")
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json(action);
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; actionId: string }> }
) {
  const denied = await requireMinLevelApi(MANAGER);
  if (denied) return denied;

  const { actionId } = await params;
  const { error } = await db().from("MeetingActionItem").delete().eq("id", actionId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
