import { prisma } from "@/lib/prisma";
import { NextRequest, NextResponse } from "next/server";

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; reviewId: string }> }
) {
  const { reviewId } = await params;
  const body = await req.json();

  const review = await prisma.meetingProjectReview.update({
    where: { id: reviewId },
    data: {
      nextSteps: body.nextSteps,
      sprintHealth: body.sprintHealth,
      attentionPoints: body.attentionPoints,
      additionalNotes: body.additionalNotes,
    },
  });

  return NextResponse.json(review);
}
