import { db } from "@/lib/db";
import { NextRequest, NextResponse } from "next/server";
import { requireMinLevelApi, getMemberId, canViewMeeting } from "@/lib/dal";
import { MANAGER } from "@/lib/roles";

const MEETING_SELECT = `
  *,
  projectReviews:MeetingProjectReview(
    *, project:Project(name), member:Member(name)
  ),
  actionItems:Todo(
    *, assignee:Member!Todo_assigneeId_fkey(name)
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

  const supabase = db();
  const { data: meetings, error } = await supabase
    .from("Meeting")
    .select(MEETING_SELECT)
    .order("date", { ascending: false });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // db() bypasses RLS, so filter by visibility here. Admin sees all; PMs see
  // only meetings they attended (pm_review/general) or where they're PM of
  // a linked project (daily/super_planning).
  const linkedProjectIds = Array.from(
    new Set(
      ((meetings ?? []) as { projectLinks?: { projectId: string }[] }[])
        .flatMap((m) => m.projectLinks ?? [])
        .map((l) => l.projectId),
    ),
  );
  const projectPmMap = new Map<string, string | null>();
  if (linkedProjectIds.length > 0) {
    const { data: projects } = await supabase
      .from("Project")
      .select("id, pmId")
      .in("id", linkedProjectIds);
    for (const p of projects ?? []) projectPmMap.set(p.id, p.pmId ?? null);
  }

  const visible: typeof meetings = [];
  for (const m of meetings ?? []) {
    const attendeeMemberIds = ((m as { attendees?: { memberId: string | null }[] }).attendees ?? [])
      .map((a) => a.memberId)
      .filter((x): x is string => !!x);
    const linkedProjectPmIds = ((m as { projectLinks?: { projectId: string }[] }).projectLinks ?? [])
      .map((l) => projectPmMap.get(l.projectId) ?? null)
      .filter((x): x is string => !!x);
    const ok = await canViewMeeting({
      type: (m as { type: string }).type,
      attendeeMemberIds,
      linkedProjectPmIds,
    });
    if (ok) visible.push(m);
  }

  return NextResponse.json(visible);
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
      sprintId = null,
    }: {
      date: string;
      notes?: string;
      type?: "pm_review" | "general" | "daily" | "super_planning";
      title?: string | null;
      pmMemberIds?: string[];
      attendees?: AttendeeInput[];
      projectIds?: string[];
      sprintId?: string | null;
    } = body;

    const supabase = db();

    if (type === "daily" && projectIds.length !== 1) {
      return NextResponse.json(
        { error: "Daily requer exatamente um projeto vinculado." },
        { status: 400 }
      );
    }

    let resolvedSprintId: string | null = sprintId;
    if (type === "super_planning") {
      if (projectIds.length !== 1) {
        return NextResponse.json(
          { error: "Super Planning requer exatamente um projeto." },
          { status: 400 }
        );
      }
      const { data: activeSprint } = await supabase
        .from("Sprint")
        .select("id")
        .eq("projectId", projectIds[0])
        .eq("status", "active")
        .maybeSingle();
      if (!activeSprint) {
        return NextResponse.json(
          { error: "Projeto sem sprint ativa. Crie ou ative uma sprint antes." },
          { status: 400 }
        );
      }
      resolvedSprintId = activeSprint.id;
    }

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

    // Daily/super_planning: if caller didn't pass attendees, default to the
    // ProjectMember squad of the linked project(s). Defense against quick clicks
    // that skip the picker — UI normally sends the explicit list.
    if (
      (type === "daily" || type === "super_planning") &&
      resolvedAttendees.length === 0 &&
      projectIds.length > 0
    ) {
      const { data: pms } = await supabase
        .from("ProjectMember")
        .select("memberId")
        .in("projectId", projectIds);
      const seen = new Set<string>();
      resolvedAttendees = (pms ?? [])
        .filter((p) => {
          if (seen.has(p.memberId)) return false;
          seen.add(p.memberId);
          return true;
        })
        .map((p) => ({ memberId: p.memberId, role: "attendee" }));
    }

    const { data: meetingId, error: rpcError } = await supabase.rpc(
      "create_meeting_with_reviews",
      {
        p_date: new Date(date).toISOString(),
        p_reviews: reviews,
        p_carry_actions: [],
        p_type: type,
        p_title: title ?? undefined,
        p_attendees: resolvedAttendees,
        p_project_ids: projectIds,
        p_notes: notes ?? undefined,
        p_sprint_id: resolvedSprintId ?? undefined,
      }
    );
    if (rpcError) throw rpcError;

    // Stamp createdById so RLS pode permitir UPDATE/DELETE futuro pelo PM autor.
    // RPC roda como service_role e não tem contexto do caller; fazemos o
    // update aqui com o member do request.
    const memberId = await getMemberId();
    if (memberId) {
      await supabase
        .from("Meeting")
        .update({ createdById: memberId })
        .eq("id", meetingId as unknown as string);
    }

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
