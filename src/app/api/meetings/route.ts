import { prisma } from "@/lib/prisma";
import { NextRequest, NextResponse } from "next/server";

export async function GET() {
  const meetings = await prisma.weeklyMeeting.findMany({
    include: {
      projectReviews: {
        include: {
          project: { select: { name: true } },
          member: { select: { name: true } },
        },
      },
      actionItems: {
        include: {
          assignee: { select: { name: true } },
        },
      },
    },
    orderBy: { date: "desc" },
  });
  return NextResponse.json(meetings);
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { date, notes } = body;

    // Get active projects that have a PM assigned
    const projects = await prisma.project.findMany({
      where: {
        status: "active",
        pmId: { not: null },
      },
      include: { pm: true },
    });

    // Create meeting with auto-populated project reviews
    const meeting = await prisma.weeklyMeeting.create({
      data: {
        date: new Date(date),
        notes: notes || null,
        status: "scheduled",
        projectReviews: {
          create: projects
            .filter((p) => p.pmId !== null)
            .map((project, index) => ({
              projectId: project.id,
              memberId: project.pmId!,
              order: index,
            })),
        },
      },
      include: {
        projectReviews: {
          include: {
            project: { select: { name: true } },
            member: { select: { name: true } },
          },
        },
        actionItems: true,
      },
    });

    // Carry over pending actions from last meeting
    const lastMeeting = await prisma.weeklyMeeting.findFirst({
      where: { id: { not: meeting.id }, status: "done" },
      orderBy: { date: "desc" },
      include: {
        actionItems: {
          where: { status: { in: ["todo", "doing"] } },
        },
      },
    });

    if (lastMeeting && lastMeeting.actionItems.length > 0) {
      await Promise.all(
        lastMeeting.actionItems.map((action) =>
          prisma.meetingActionItem.create({
            data: {
              meetingId: meeting.id,
              description: action.description,
              assigneeId: action.assigneeId,
              dueDate: action.dueDate,
              status: action.status,
              sourceReviewId: null,
            },
          })
        )
      );
    }

    // Re-fetch with all data
    const full = await prisma.weeklyMeeting.findUnique({
      where: { id: meeting.id },
      include: {
        projectReviews: {
          include: {
            project: { select: { name: true } },
            member: { select: { name: true } },
          },
          orderBy: { order: "asc" },
        },
        actionItems: {
          include: { assignee: { select: { name: true } } },
        },
      },
    });

    return NextResponse.json(full, { status: 201 });
  } catch (error) {
    console.error("Error creating meeting:", error);
    return NextResponse.json(
      { error: "Failed to create meeting", details: String(error) },
      { status: 500 }
    );
  }
}
