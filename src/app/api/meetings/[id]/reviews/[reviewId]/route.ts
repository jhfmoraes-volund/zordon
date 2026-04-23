import { db } from "@/lib/db";
import { NextRequest, NextResponse } from "next/server";
import { requireMinLevelApi } from "@/lib/dal";
import { MANAGER } from "@/lib/roles";

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; reviewId: string }> }
) {
  const denied = await requireMinLevelApi(MANAGER);
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
