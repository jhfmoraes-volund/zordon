import { db } from "@/lib/db";
import { NextRequest, NextResponse } from "next/server";
import { requireMinLevelApi, getCurrentMember } from "@/lib/dal";
import { MANAGER } from "@/lib/roles";
import type { Database } from "@/lib/supabase/database.types";

type Insert = Database["public"]["Tables"]["MeetingTaskAction"]["Insert"];
type JsonPayload = Insert["payload"];

const SELECT = `
  *,
  task:Task(id, reference, title, status, scope, complexity, type, priority,
            sprintId, projectId, assignments:TaskAssignment(*, member:Member(id, name))),
  targetSprint:Sprint!MeetingTaskAction_targetSprintId_fkey(id, name),
  decidedBy:Member!MeetingTaskAction_decidedById_fkey(id, name)
`;

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const denied = await requireMinLevelApi(MANAGER);
  if (denied) return denied;

  const { id } = await params;
  const { data, error } = await db()
    .from("MeetingTaskAction")
    .select(SELECT)
    .eq("meetingId", id)
    .order("createdAt", { ascending: true });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data ?? []);
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const denied = await requireMinLevelApi(MANAGER);
  if (denied) return denied;

  const me = await getCurrentMember();
  if (!me) return NextResponse.json({ error: "No member" }, { status: 401 });

  const { id: meetingId } = await params;
  const body = await req.json();
  const {
    type,
    projectId,
    taskId = null,
    targetSprintId = null,
    payload = {},
    source = "manual",
    aiReasoning = null,
    aiConfidence = null,
    notes = null,
    reviewReasons = null,
    reviewNote = null,
  } = body as {
    type: "create" | "update" | "delete" | "move" | "review";
    projectId: string;
    taskId?: string | null;
    targetSprintId?: string | null;
    payload?: Record<string, unknown>;
    source?: "ai" | "manual";
    aiReasoning?: string | null;
    aiConfidence?: number | null;
    notes?: string | null;
    reviewReasons?: string[] | null;
    reviewNote?: string | null;
  };

  if (!type || !projectId) {
    return NextResponse.json(
      { error: "type and projectId are required" },
      { status: 400 }
    );
  }
  if (type !== "create" && !taskId) {
    return NextResponse.json(
      { error: "taskId is required for non-create actions" },
      { status: 400 }
    );
  }
  if (type === "move" && !targetSprintId) {
    return NextResponse.json(
      { error: "targetSprintId is required for move actions" },
      { status: 400 }
    );
  }

  // Manual = já approved (PM criou); AI = pending (precisa aprovar)
  const decision = source === "manual" ? "approved" : "pending";
  const decidedAt = source === "manual" ? new Date().toISOString() : null;
  const decidedById = source === "manual" ? me.id : null;

  const row: Insert = {
    id: crypto.randomUUID(),
    meetingId,
    projectId,
    type,
    taskId,
    targetSprintId,
    payload: payload as JsonPayload,
    decision,
    decidedAt,
    decidedById,
    source,
    aiReasoning,
    aiConfidence,
    notes,
    reviewReasons,
    reviewNote,
    updatedAt: new Date().toISOString(),
  };

  const { data, error } = await db()
    .from("MeetingTaskAction")
    .insert(row)
    .select(SELECT)
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data, { status: 201 });
}
