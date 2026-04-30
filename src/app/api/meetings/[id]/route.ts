import { db } from "@/lib/db";
import { NextRequest, NextResponse } from "next/server";
import {
  requireMinLevelApi,
  canViewMeeting,
  canEditMeeting,
} from "@/lib/dal";
import { MANAGER } from "@/lib/roles";

const MEETING_SELECT = `
  *,
  projectReviews:MeetingProjectReview(
    *,
    project:Project(id, name, status),
    member:Member(id, name),
    actionItems:Todo(
      *, assignee:Member!Todo_assigneeId_fkey(id, name)
    )
  ),
  actionItems:Todo(
    *,
    assignee:Member!Todo_assigneeId_fkey(id, name),
    sourceReview:MeetingProjectReview(project:Project(name))
  ),
  attendees:MeetingAttendee(
    *, member:Member(id, name)
  ),
  projectLinks:MeetingProjectLink(
    *, project:Project(id, name, status)
  )
`;

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const denied = await requireMinLevelApi(MANAGER);
  if (denied) return denied;

  const { id } = await params;
  const supabase = db();

  // For pm_review meetings, sync any missing project reviews for active projects
  // whose PM is among the meeting's selected PMs (derived from existing reviews).
  // We don't auto-add PMs that weren't selected at meeting creation time.
  const { data: meetingMeta } = await supabase
    .from("Meeting")
    .select("id, type")
    .eq("id", id)
    .maybeSingle();

  if (meetingMeta?.type === "pm_review") {
    const { data: existingReviews } = await supabase
      .from("MeetingProjectReview")
      .select("projectId, memberId")
      .eq("meetingId", id);

    const pmIds = Array.from(
      new Set((existingReviews ?? []).map((r) => r.memberId))
    );

    if (pmIds.length > 0) {
      const { data: activeProjects } = await supabase
        .from("Project")
        .select("id, pmId")
        .eq("status", "active")
        .in("pmId", pmIds);

      const existingProjectIds = new Set(
        (existingReviews ?? []).map((r) => r.projectId)
      );
      const missing = (activeProjects ?? []).filter(
        (p) => p.pmId && !existingProjectIds.has(p.id)
      );

      if (missing.length > 0) {
        const maxOrder = (existingReviews ?? []).length;
        await supabase
          .from("MeetingProjectReview")
          .insert(
            missing.map((p, i) => ({
              id: crypto.randomUUID(),
              meetingId: id,
              projectId: p.id,
              memberId: p.pmId!,
              order: maxOrder + i,
              updatedAt: new Date().toISOString(),
            }))
          );
      }
    }
  }

  const { data: meeting } = await supabase
    .from("Meeting")
    .select(MEETING_SELECT)
    .eq("id", id)
    .maybeSingle();

  if (!meeting) return NextResponse.json({ error: "Not found" }, { status: 404 });

  // db() bypasses RLS — apply meeting visibility rule here.
  const m = meeting as {
    type: string;
    attendees?: { memberId: string | null }[];
    projectLinks?: { projectId: string }[];
  };
  const attendeeMemberIds = (m.attendees ?? [])
    .map((a) => a.memberId)
    .filter((x): x is string => !!x);
  const linkedProjectIds = (m.projectLinks ?? []).map((l) => l.projectId);
  const linkedProjectPmIds: string[] = [];
  if (linkedProjectIds.length > 0) {
    const { data: projects } = await supabase
      .from("Project")
      .select("pmId")
      .in("id", linkedProjectIds);
    for (const p of projects ?? []) {
      if (p.pmId) linkedProjectPmIds.push(p.pmId);
    }
  }
  const visible = await canViewMeeting({
    type: m.type,
    attendeeMemberIds,
    linkedProjectPmIds,
  });
  if (!visible) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  if ((meeting as { projectReviews?: { order: number }[] }).projectReviews) {
    (meeting as { projectReviews: { order: number }[] }).projectReviews.sort(
      (a, b) => a.order - b.order
    );
  }
  if ((meeting as { actionItems?: { createdAt: string }[] }).actionItems) {
    (meeting as { actionItems: { createdAt: string }[] }).actionItems.sort(
      (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
    );
  }

  return NextResponse.json(meeting);
}

async function gateEdit(meetingId: string): Promise<Response | null> {
  const denied = await requireMinLevelApi(MANAGER);
  if (denied) return denied;
  const { data: m } = await db()
    .from("Meeting")
    .select("createdById")
    .eq("id", meetingId)
    .maybeSingle();
  if (!m) return new Response("Not found", { status: 404 });
  if (await canEditMeeting(m.createdById)) return null;
  return new Response("Forbidden — only the creator or an admin can modify", {
    status: 403,
  });
}

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const denied = await gateEdit(id);
  if (denied) return denied;

  const body = await req.json();

  const patch: { notes?: string | null; title?: string | null } = {};
  if (body.notes !== undefined) patch.notes = body.notes;
  if (body.title !== undefined) patch.title = body.title;

  const { data: meeting, error } = await db()
    .from("Meeting")
    .update(patch)
    .eq("id", id)
    .select()
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json(meeting);
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const denied = await gateEdit(id);
  if (denied) return denied;

  const { error } = await db().from("Meeting").delete().eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
