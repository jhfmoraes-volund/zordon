import { db } from "@/lib/db";
import { NextRequest, NextResponse } from "next/server";
import { requireMinLevelApi } from "@/lib/dal";
import { MANAGER } from "@/lib/roles";

export async function GET() {
  const denied = await requireMinLevelApi(MANAGER);
  if (denied) return denied;

  const { data: meetings, error } = await db()
    .from("WeeklyMeeting")
    .select(`
      *,
      projectReviews:MeetingProjectReview(
        *, project:Project(name), member:Member(name)
      ),
      actionItems:MeetingActionItem(
        *, assignee:Member!MeetingActionItem_assigneeId_fkey(name)
      )
    `)
    .order("date", { ascending: false });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(meetings);
}

export async function POST(req: NextRequest) {
  const denied = await requireMinLevelApi(MANAGER);
  if (denied) return denied;

  try {
    const body = await req.json();
    const { date, notes } = body;
    const supabase = db();

    // Get active projects with PM
    const { data: projects } = await supabase
      .from("Project")
      .select("id, pmId")
      .eq("status", "active")
      .not("pmId", "is", null);

    const reviews = (projects ?? []).map((p, i) => ({
      projectId: p.id,
      memberId: p.pmId!,
      order: i,
    }));

    // Get pending actions from last done meeting
    const { data: lastMeeting } = await supabase
      .from("WeeklyMeeting")
      .select("id")
      .eq("status", "done")
      .order("date", { ascending: false })
      .limit(1)
      .maybeSingle();

    let carryActions: any[] = [];
    if (lastMeeting) {
      const { data: pendingActions } = await supabase
        .from("MeetingActionItem")
        .select("*")
        .eq("meetingId", lastMeeting.id)
        .in("status", ["todo", "doing"]);
      carryActions = (pendingActions ?? []).map((a) => ({
        description: a.description,
        assigneeId: a.assigneeId,
        dueDate: a.dueDate,
      }));
    }

    // Use RPC for atomic creation
    const { data: meetingId, error: rpcError } = await supabase.rpc(
      "create_meeting_with_reviews",
      {
        p_date: new Date(date).toISOString(),
        p_reviews: reviews,
        p_carry_actions: carryActions,
      }
    );
    if (rpcError) throw rpcError;

    // Update notes if provided
    if (notes) {
      await supabase
        .from("WeeklyMeeting")
        .update({ notes })
        .eq("id", meetingId);
    }

    // Fetch complete meeting
    const { data: full } = await supabase
      .from("WeeklyMeeting")
      .select(`
        *,
        projectReviews:MeetingProjectReview(
          *, project:Project(name), member:Member(name)
        ),
        actionItems:MeetingActionItem(
          *, assignee:Member!MeetingActionItem_assigneeId_fkey(name)
        )
      `)
      .eq("id", meetingId)
      .single();

    return NextResponse.json(full, { status: 201 });
  } catch (error) {
    console.error("Error creating meeting:", error);
    return NextResponse.json(
      { error: "Failed to create meeting", details: String(error) },
      { status: 500 }
    );
  }
}
