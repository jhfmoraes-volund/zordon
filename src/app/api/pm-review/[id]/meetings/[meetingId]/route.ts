import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { unlinkMeetingFromPMReview } from "@/lib/dal/pm-review";
import { canCreatePMReviewForProject } from "@/lib/pm-review/permission";

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; meetingId: string }> },
) {
  const { id, meetingId } = await params;

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

  await unlinkMeetingFromPMReview({ pmReviewId: id, meetingId });
  return NextResponse.json({ ok: true });
}
