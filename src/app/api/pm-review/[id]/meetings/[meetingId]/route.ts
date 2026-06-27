import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { unlinkMeetingFromPMReview } from "@/lib/dal/pm-review";
import { requireCapabilityApi } from "@/lib/access/require-capability";

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

  const denied = await requireCapabilityApi("pm_review.write", {
    projectId: pm.projectId,
  });
  if (denied) return denied;

  await unlinkMeetingFromPMReview({ pmReviewId: id, meetingId });
  return NextResponse.json({ ok: true });
}
