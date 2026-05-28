import { db } from "@/lib/db";
import { NextRequest, NextResponse } from "next/server";
import {
  requireMinLevelApi,
  canViewMeeting,
  getMemberId,
} from "@/lib/dal";
import { BUILDER } from "@/lib/roles";

/**
 * GET /api/meetings/[id]/personal-note
 * PUT /api/meetings/[id]/personal-note  body: { content: string }
 *
 * Each row in MeetingPersonalNote is strictly private to one member —
 * the table's RLS already enforces "self only" with no admin bypass.
 * These routes use db() = service_role which bypasses RLS, so the app
 * layer pins (meetingId, currentMemberId) explicitly to preserve the
 * invariant: a member can only read/write their own note.
 *
 * Visibility precondition: caller must also be allowed to see the parent
 * meeting (via canViewMeeting). Without that, a builder could ping a
 * meeting they don't belong to and discover that it exists by getting a
 * 200 instead of 404.
 */

type NoteRow = {
  meetingId: string;
  memberId: string;
  content: string;
  updatedAt: string;
};

async function ensureCallerCanSeeMeeting(
  meetingId: string,
): Promise<NextResponse | null> {
  const supabase = db();
  const { data: meeting } = await supabase
    .from("Meeting")
    .select("id, visibility, createdById, attendees:MeetingAttendee(memberId)")
    .eq("id", meetingId)
    .maybeSingle();
  if (!meeting) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const attendeeMemberIds = (
    (meeting.attendees ?? []) as { memberId: string | null }[]
  )
    .map((a) => a.memberId)
    .filter((x): x is string => !!x);
  const visible = await canViewMeeting({
    visibility: meeting.visibility,
    attendeeMemberIds,
    linkedProjectPmIds: [],
    createdById: meeting.createdById ?? null,
  });
  if (!visible) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  return null;
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const denied = await requireMinLevelApi(BUILDER);
  if (denied) return denied;

  const { id: meetingId } = await params;
  const memberId = await getMemberId();
  if (!memberId) {
    return NextResponse.json({ error: "Member not found" }, { status: 403 });
  }

  const accessDenied = await ensureCallerCanSeeMeeting(meetingId);
  if (accessDenied) return accessDenied;

  const { data, error } = await db()
    .from("MeetingPersonalNote")
    .select("content, updatedAt")
    .eq("meetingId", meetingId)
    .eq("memberId", memberId)
    .maybeSingle();
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json(
    data ?? { content: "", updatedAt: null },
  );
}

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const denied = await requireMinLevelApi(BUILDER);
  if (denied) return denied;

  const { id: meetingId } = await params;
  const memberId = await getMemberId();
  if (!memberId) {
    return NextResponse.json({ error: "Member not found" }, { status: 403 });
  }

  const accessDenied = await ensureCallerCanSeeMeeting(meetingId);
  if (accessDenied) return accessDenied;

  const body = (await req.json().catch(() => null)) as { content?: string } | null;
  if (!body || typeof body.content !== "string") {
    return NextResponse.json({ error: "content (string) obrigatório" }, { status: 400 });
  }

  const row: Pick<NoteRow, "meetingId" | "memberId" | "content" | "updatedAt"> = {
    meetingId,
    memberId,
    content: body.content,
    updatedAt: new Date().toISOString(),
  };

  const { error } = await db()
    .from("MeetingPersonalNote")
    .upsert(row, { onConflict: "meetingId,memberId" });
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ content: row.content, updatedAt: row.updatedAt });
}
