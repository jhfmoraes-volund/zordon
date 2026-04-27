import { db } from "@/lib/db";
import { NextRequest, NextResponse } from "next/server";
import { requireMinLevelApi } from "@/lib/dal";
import { MANAGER } from "@/lib/roles";
import { suggestActions } from "@/lib/meetings/task-action-suggester";
import type { Database } from "@/lib/supabase/database.types";

type Insert = Database["public"]["Tables"]["MeetingTaskAction"]["Insert"];

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const denied = await requireMinLevelApi(MANAGER);
  if (denied) return denied;

  const { id: meetingId } = await params;
  const { projectId } = (await req.json().catch(() => ({}))) as {
    projectId?: string;
  };

  if (!projectId) {
    return NextResponse.json({ error: "projectId is required" }, { status: 400 });
  }

  try {
    const supabase = db();
    const suggestions = await suggestActions(supabase, meetingId, projectId);

    if (suggestions.length === 0) {
      return NextResponse.json({ inserted: 0, actions: [] });
    }

    const rows: Insert[] = suggestions.map((s) => ({
      id: crypto.randomUUID(),
      meetingId,
      projectId,
      type: s.type,
      taskId: s.taskId ?? null,
      targetSprintId: s.targetSprintId ?? null,
      payload: (s.payload ?? {}) as Insert["payload"],
      decision: "pending",
      execution: "pending",
      source: "ai",
      aiReasoning: s.reasoning,
      aiConfidence: s.confidence,
      reviewReasons: s.reviewReasons ?? null,
      reviewNote: s.reviewNote ?? null,
      updatedAt: new Date().toISOString(),
    }));

    const { data, error } = await supabase
      .from("MeetingTaskAction")
      .insert(rows)
      .select("*");

    if (error) throw error;

    return NextResponse.json({ inserted: data?.length ?? 0, actions: data });
  } catch (error) {
    console.error("suggest failed:", error);
    return NextResponse.json(
      { error: "Failed to generate suggestions", details: String(error) },
      { status: 500 }
    );
  }
}
