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
    createdById?: string | null;
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
    createdById: m.createdById ?? null,
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

type AttendeeInput = {
  memberId?: string | null;
  externalName?: string | null;
  externalEmail?: string | null;
  externalRole?: string | null;
  role?: string | null;
};

type PutBody = {
  date?: string;
  title?: string | null;
  notes?: string | null;
  transcript?: string | null;
  pmMemberIds?: string[];
  attendees?: AttendeeInput[];
  projectIds?: string[];
  transcriptSource?: "roam" | "granola" | null;
  transcriptSourceId?: string | null;
};

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const denied = await gateEdit(id);
  if (denied) return denied;

  const body = (await req.json()) as PutBody;
  const supabase = db();

  // Carrega tipo atual — não permitimos trocar tipo no edit
  const { data: existing } = await supabase
    .from("Meeting")
    .select("id, type")
    .eq("id", id)
    .maybeSingle();
  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const type = existing.type as "pm_review" | "general" | "daily" | "super_planning" | "private";

  // 1. Patch nos campos simples do Meeting
  const patch: {
    notes?: string | null;
    title?: string | null;
    date?: string;
    transcript?: string | null;
    transcriptSource?: "roam" | "granola" | null;
    transcriptSourceId?: string | null;
  } = {};
  if (body.notes !== undefined) patch.notes = body.notes;
  if (body.title !== undefined) patch.title = body.title;
  if (body.transcript !== undefined) patch.transcript = body.transcript;
  if (body.date !== undefined) patch.date = new Date(body.date).toISOString();

  if (body.transcriptSource !== undefined || body.transcriptSourceId !== undefined) {
    const src = body.transcriptSource ?? null;
    const sid = body.transcriptSourceId ?? null;
    if ((src && !sid) || (!src && sid)) {
      return NextResponse.json(
        { error: "transcriptSource e transcriptSourceId devem vir juntos." },
        { status: 400 },
      );
    }
    patch.transcriptSource = src;
    patch.transcriptSourceId = sid;
  }

  if (Object.keys(patch).length > 0) {
    const { error } = await supabase.from("Meeting").update(patch).eq("id", id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // 2. pm_review: diff de PMs (A1 — adicionar OK, remover só se review vazio)
  if (type === "pm_review" && body.pmMemberIds !== undefined) {
    // Filtra UUIDs válidos defensivamente
    const nextPmIds = new Set(
      body.pmMemberIds.filter(
        (x): x is string => typeof x === "string" && x.length > 0,
      ),
    );

    const { data: currentReviews, error: revErr } = await supabase
      .from("MeetingProjectReview")
      .select("id, memberId, projectId, sprintHealth, nextSteps, attentionPoints, additionalNotes, order")
      .eq("meetingId", id);
    if (revErr) {
      return NextResponse.json({ error: revErr.message }, { status: 500 });
    }
    const currentPmIds = new Set((currentReviews ?? []).map((r) => r.memberId));

    const toRemove = (currentReviews ?? []).filter((r) => !nextPmIds.has(r.memberId));
    // sprintHealth tem default "healthy" — não conta como "preenchido pelo user".
    // Só bloqueamos remoção quando há texto livre escrito.
    const blocked = toRemove.filter(
      (r) =>
        (r.nextSteps && r.nextSteps.trim().length > 0) ||
        (r.attentionPoints && r.attentionPoints.trim().length > 0) ||
        (r.additionalNotes && r.additionalNotes.trim().length > 0),
    );
    if (blocked.length > 0) {
      return NextResponse.json(
        {
          error:
            "Não é possível remover PMs cujos reviews já foram preenchidos. Limpe os campos do review antes ou mantenha o PM.",
        },
        { status: 400 },
      );
    }

    if (toRemove.length > 0) {
      const removeIds = toRemove.map((r) => r.id);
      const { error: todoErr } = await supabase
        .from("Todo")
        .update({ sourceReviewId: null })
        .in("sourceReviewId", removeIds);
      if (todoErr) {
        return NextResponse.json({ error: todoErr.message }, { status: 500 });
      }
      const { error: delErr } = await supabase
        .from("MeetingProjectReview")
        .delete()
        .in("id", removeIds);
      if (delErr) {
        return NextResponse.json({ error: delErr.message }, { status: 500 });
      }
    }

    const toAddPmIds = Array.from(nextPmIds).filter((pmId) => !currentPmIds.has(pmId));
    if (toAddPmIds.length > 0) {
      const { data: addProjects, error: projErr } = await supabase
        .from("Project")
        .select("id, pmId")
        .eq("status", "active")
        .in("pmId", toAddPmIds);
      if (projErr) {
        return NextResponse.json({ error: projErr.message }, { status: 500 });
      }
      const baseOrder = (currentReviews ?? []).length - toRemove.length;
      if (addProjects && addProjects.length > 0) {
        const newReviews = addProjects.map((p, i) => ({
          id: crypto.randomUUID(),
          meetingId: id,
          projectId: p.id,
          memberId: p.pmId!,
          order: baseOrder + i,
          updatedAt: new Date().toISOString(),
        }));
        const { error: insErr } = await supabase
          .from("MeetingProjectReview")
          .insert(newReviews);
        if (insErr) {
          return NextResponse.json({ error: insErr.message }, { status: 500 });
        }
      }
    }

    // Sincroniza attendees com nextPmIds. Em pm_review, todos os attendees são PMs
    // por design — registros antigos podem ter role=null, então limpamos tudo.
    if (body.attendees === undefined) {
      const { error: delAttErr } = await supabase
        .from("MeetingAttendee")
        .delete()
        .eq("meetingId", id);
      if (delAttErr) {
        return NextResponse.json({ error: delAttErr.message }, { status: 500 });
      }
      if (nextPmIds.size > 0) {
        const { error: insAttErr } = await supabase.from("MeetingAttendee").insert(
          Array.from(nextPmIds).map((memberId) => ({
            id: crypto.randomUUID(),
            meetingId: id,
            memberId,
            role: "pm",
          })),
        );
        if (insAttErr) {
          return NextResponse.json({ error: insAttErr.message }, { status: 500 });
        }
      }
    }
  }

  // 3. Attendees (reset) — general/daily/super_planning.
  // Private: attendee = owner sempre. Ignoramos qualquer attendees vindos no body.
  if (body.attendees !== undefined && type !== "pm_review" && type !== "private") {
    await supabase.from("MeetingAttendee").delete().eq("meetingId", id);
    if (body.attendees.length > 0) {
      await supabase.from("MeetingAttendee").insert(
        body.attendees.map((a) => ({
          id: crypto.randomUUID(),
          meetingId: id,
          memberId: a.memberId ?? null,
          externalName: a.externalName ?? null,
          externalEmail: a.externalEmail ?? null,
          externalRole: a.externalRole ?? null,
          role: a.role ?? null,
        })),
      );
    }
  }

  // 4. Project links (C — daily/general permitem, super_planning trava)
  if (body.projectIds !== undefined && type !== "pm_review") {
    if (type === "super_planning") {
      return NextResponse.json(
        { error: "Não é possível alterar o projeto de uma reunião Super Planning." },
        { status: 400 },
      );
    }
    if (type === "daily" && body.projectIds.length !== 1) {
      return NextResponse.json(
        { error: "Daily requer exatamente um projeto vinculado." },
        { status: 400 },
      );
    }
    await supabase.from("MeetingProjectLink").delete().eq("meetingId", id);
    if (body.projectIds.length > 0) {
      await supabase.from("MeetingProjectLink").insert(
        body.projectIds.map((projectId) => ({ meetingId: id, projectId })),
      );
    }
  }

  // 5. Retorna meeting completo
  const { data: meeting, error: selErr } = await supabase
    .from("Meeting")
    .select(`
      *,
      projectReviews:MeetingProjectReview(
        *, project:Project(id, name, status), member:Member(id, name)
      ),
      actionItems:Todo(
        *, assignee:Member!Todo_assigneeId_fkey(id, name)
      ),
      attendees:MeetingAttendee(
        *, member:Member(id, name)
      ),
      projectLinks:MeetingProjectLink(
        *, project:Project(id, name, status)
      )
    `)
    .eq("id", id)
    .single();
  if (selErr) return NextResponse.json({ error: selErr.message }, { status: 500 });

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
