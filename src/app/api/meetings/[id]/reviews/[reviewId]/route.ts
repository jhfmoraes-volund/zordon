import { db } from "@/lib/db";
import { NextRequest, NextResponse } from "next/server";
import { requireCapabilityApi } from "@/lib/access/require-capability";

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; reviewId: string }> }
) {
  // Editar review de reunião é operação de PM (manager+). Reconcilia
  // requireMinLevelApi(MANAGER): sem projectId, meeting.edit gateia manager+.
  const denied = await requireCapabilityApi("meeting.edit");
  if (denied) return denied;

  const { reviewId } = await params;
  const body = await req.json();

  const { data: review, error } = await db()
    .from("MeetingProjectReview")
    .update({
      nextSteps: body.nextSteps,
      sprintHealth: body.sprintHealth,
      attentionPoints: body.attentionPoints,
      additionalNotes: body.additionalNotes,
    })
    .eq("id", reviewId)
    .select()
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json(review);
}
