import { db } from "@/lib/db";
import { NextRequest, NextResponse } from "next/server";
import { requireMinLevelApi } from "@/lib/dal";
import { MANAGER } from "@/lib/roles";

const MEETING_SELECT = `
  *,
  projectReviews:MeetingProjectReview(
    *, project:Project(name), member:Member(name)
  ),
  actionItems:MeetingActionItem(
    *, assignee:Member!MeetingActionItem_assigneeId_fkey(name)
  ),
  attendees:MeetingAttendee(
    *, member:Member(id, name)
  ),
  projectLinks:MeetingProjectLink(
    *, project:Project(id, name, status)
  )
`;

type AttendeeInput = {
  memberId?: string | null;
  externalName?: string | null;
  externalEmail?: string | null;
  externalRole?: string | null;
  role?: string | null;
};

export async function GET() {
  const denied = await requireMinLevelApi(MANAGER);
  if (denied) return denied;

  const { data: meetings, error } = await db()
    .from("Meeting")
    .select(MEETING_SELECT)
    .order("date", { ascending: false });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(meetings);
}

export async function POST(req: NextRequest) {
  const denied = await requireMinLevelApi(MANAGER);
  if (denied) return denied;

  try {
    const body = await req.json();
    const {
      date,
      notes,
      type = "pm_review",
      title = null,
      pmMemberIds = [],
      attendees = [],
      projectIds = [],
    }: {
      date: string;
      notes?: string;
      type?: "pm_review" | "general";
      title?: string | null;
      pmMemberIds?: string[];
      attendees?: AttendeeInput[];
      projectIds?: string[];
    } = body;

    const supabase = db();

    let reviews: Array<{ projectId: string; memberId: string; order: number }> = [];
    let resolvedAttendees: AttendeeInput[] = attendees;

    if (type === "pm_review") {
      // Build reviews from selected PMs (or fall back to all PMs with active projects)
      let pmFilter = supabase
        .from("Project")
        .select("id, pmId")
        .eq("status", "active")
        .not("pmId", "is", null);
      if (pmMemberIds.length > 0) {
        pmFilter = pmFilter.in("pmId", pmMemberIds);
      }
      const { data: projects } = await pmFilter;

      reviews = (projects ?? []).map((p, i) => ({
        projectId: p.id,
        memberId: p.pmId!,
        order: i,
      }));

      // PM attendees derived from selected (or implicit) PMs if caller didn't pass them
      if (resolvedAttendees.length === 0 && pmMemberIds.length > 0) {
        resolvedAttendees = pmMemberIds.map((id) => ({ memberId: id, role: "pm" }));
      }
    }

    // Carry over pending actions from previous done meeting (any type)
    const { data: lastMeeting } = await supabase
      .from("Meeting")
      .select("id")
      .eq("status", "done")
      .order("date", { ascending: false })
      .limit(1)
      .maybeSingle();

    let carryActions: Array<{
      description: string;
      assigneeId: string;
      dueDate: string | null;
    }> = [];
    if (lastMeeting) {
      const { data: pendingActions } = await supabase
        .from("MeetingActionItem")
        .select("description, assigneeId, dueDate")
        .eq("meetingId", lastMeeting.id)
        .in("status", ["todo", "doing"]);
      carryActions = (pendingActions ?? []).map((a) => ({
        description: a.description,
        assigneeId: a.assigneeId,
        dueDate: a.dueDate,
      }));
    }

    const { data: meetingId, error: rpcError } = await supabase.rpc(
      "create_meeting_with_reviews",
      {
        p_date: new Date(date).toISOString(),
        p_reviews: reviews,
        p_carry_actions: carryActions,
        p_type: type,
        p_title: title,
        p_attendees: resolvedAttendees,
        p_project_ids: projectIds,
        p_notes: notes ?? null,
      }
    );
    if (rpcError) throw rpcError;

    const { data: full } = await supabase
      .from("Meeting")
      .select(MEETING_SELECT)
      .eq("id", meetingId as unknown as string)
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
