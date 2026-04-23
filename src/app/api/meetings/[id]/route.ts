import { db } from "@/lib/db";
import { NextRequest, NextResponse } from "next/server";
import { requireMinLevelApi } from "@/lib/dal";
import { MANAGER } from "@/lib/roles";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const denied = await requireMinLevelApi(MANAGER);
  if (denied) return denied;

  const { id } = await params;
  const supabase = db();

  // Sync: add reviews for active projects with PM that are missing
  const [{ data: activeProjects }, { data: existingReviews }] = await Promise.all([
    supabase.from("Project").select("id, pmId").eq("status", "active").not("pmId", "is", null),
    supabase.from("MeetingProjectReview").select("projectId").eq("meetingId", id),
  ]);

  const existingProjectIds = new Set((existingReviews ?? []).map((r) => r.projectId));
  const missing = (activeProjects ?? []).filter((p) => !existingProjectIds.has(p.id));

  if (missing.length > 0) {
    const maxOrder = (existingReviews ?? []).length;
    await supabase
      .from("MeetingProjectReview")
      .insert(missing.map((p, i) => ({
        id: crypto.randomUUID(),
        meetingId: id,
        projectId: p.id,
        memberId: p.pmId!,
        order: maxOrder + i,
        updatedAt: new Date().toISOString(),
      })));
  }

  const { data: meeting } = await supabase
    .from("WeeklyMeeting")
    .select(`
      *,
      projectReviews:MeetingProjectReview(
        *,
        project:Project(id, name, status),
        member:Member(id, name),
        actionItems:MeetingActionItem(
          *, assignee:Member!MeetingActionItem_assigneeId_fkey(id, name)
        )
      ),
      actionItems:MeetingActionItem(
        *,
        assignee:Member!MeetingActionItem_assigneeId_fkey(id, name),
        sourceReview:MeetingProjectReview(project:Project(name))
      )
    `)
    .eq("id", id)
    .maybeSingle();

  if (!meeting) return NextResponse.json({ error: "Not found" }, { status: 404 });

  // Sort reviews by order, actions by createdAt
  if ((meeting as any).projectReviews) {
    (meeting as any).projectReviews.sort((a: any, b: any) => a.order - b.order);
  }
  if ((meeting as any).actionItems) {
    (meeting as any).actionItems.sort((a: any, b: any) =>
      new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
    );
  }

  return NextResponse.json(meeting);
}

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const denied = await requireMinLevelApi(MANAGER);
  if (denied) return denied;

  const { id } = await params;
  const body = await req.json();

  const { data: meeting, error } = await db()
    .from("WeeklyMeeting")
    .update({ status: body.status, notes: body.notes })
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
  const denied = await requireMinLevelApi(MANAGER);
  if (denied) return denied;

  const { id } = await params;
  const { error } = await db().from("WeeklyMeeting").delete().eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
