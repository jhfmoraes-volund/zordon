/**
 * POST /api/pm-review/[id]/meetings
 * Linka 1..N Meetings ao PM Review.
 * Body: { items: Array<{ meetingId: string, note?: string }> }
 */
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getActorMemberId } from "@/lib/dal";
import { canCreatePMReviewForProject } from "@/lib/pm-review/permission";
import { linkMeetingToPMReview } from "@/lib/dal/pm-review";

type Item = { meetingId?: string; note?: string | null };

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  const { data: pm } = await db()
    .from("PMReview")
    .select("projectId")
    .eq("id", id)
    .maybeSingle();
  if (!pm)
    return NextResponse.json({ error: "PM Review não encontrado" }, { status: 404 });

  const allowed = await canCreatePMReviewForProject(pm.projectId);
  if (!allowed)
    return NextResponse.json(
      { error: "Apenas PMs (lead) ou admins podem editar." },
      { status: 403 },
    );

  const body = (await req.json().catch(() => null)) as { items?: Item[] } | null;
  const items = body?.items ?? [];
  if (!Array.isArray(items) || items.length === 0) {
    return NextResponse.json(
      { error: "Body precisa de `items: [{ meetingId, note? }]`" },
      { status: 400 },
    );
  }

  const linkedById = await getActorMemberId();
  const created: string[] = [];

  for (const it of items) {
    if (!it.meetingId) continue;
    const res = await linkMeetingToPMReview({
      pmReviewId: id,
      meetingId: it.meetingId,
      linkedById,
      note: it.note ?? null,
    });
    if (res.created) created.push(it.meetingId);
  }

  return NextResponse.json({ linked: created.length, meetingIds: created });
}
