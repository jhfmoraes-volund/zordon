import { prisma } from "@/lib/prisma";
import { NextRequest, NextResponse } from "next/server";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const meeting = await prisma.weeklyMeeting.findUnique({
    where: { id },
    include: {
      projectReviews: {
        include: {
          project: { select: { id: true, name: true, status: true } },
          member: { select: { id: true, name: true } },
          actionItems: {
            include: { assignee: { select: { id: true, name: true } } },
          },
        },
        orderBy: { order: "asc" },
      },
      actionItems: {
        include: {
          assignee: { select: { id: true, name: true } },
          sourceReview: {
            select: { project: { select: { name: true } } },
          },
        },
        orderBy: { createdAt: "asc" },
      },
    },
  });

  if (!meeting) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json(meeting);
}

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const body = await req.json();

  const meeting = await prisma.weeklyMeeting.update({
    where: { id },
    data: {
      status: body.status,
      notes: body.notes,
    },
  });

  return NextResponse.json(meeting);
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  await prisma.weeklyMeeting.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
