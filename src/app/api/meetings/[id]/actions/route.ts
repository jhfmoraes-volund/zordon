import { prisma } from "@/lib/prisma";
import { NextRequest, NextResponse } from "next/server";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const body = await req.json();

  const action = await prisma.meetingActionItem.create({
    data: {
      meetingId: id,
      description: body.description,
      assigneeId: body.assigneeId,
      dueDate: body.dueDate ? new Date(body.dueDate) : null,
      status: "todo",
      sourceReviewId: body.sourceReviewId || null,
    },
    include: {
      assignee: { select: { id: true, name: true } },
    },
  });

  return NextResponse.json(action, { status: 201 });
}
