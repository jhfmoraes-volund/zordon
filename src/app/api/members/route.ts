import { prisma } from "@/lib/prisma";
import { NextRequest, NextResponse } from "next/server";
import { ACTIVE_STATUSES } from "@/lib/function-points";

export async function GET() {
  const members = await prisma.member.findMany({
    include: {
      _count: { select: { squadMemberships: true, taskAssignments: true } },
      taskAssignments: {
        where: {
          task: { status: { in: [...ACTIVE_STATUSES] } },
        },
        include: {
          task: {
            select: {
              functionPoints: true,
              sprintId: true,
              sprint: { select: { name: true, startDate: true, endDate: true } },
            },
          },
        },
      },
    },
    orderBy: { name: "asc" },
  });

  const result = members.map((m) => {
    const { taskAssignments, ...rest } = m;

    const fpAllocated = taskAssignments.reduce((sum, a) => {
      return sum + (a.task.functionPoints ?? 0);
    }, 0);

    return {
      ...rest,
      fpAllocated,
    };
  });

  return NextResponse.json(result);
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const member = await prisma.member.create({ data: body });
  return NextResponse.json(member, { status: 201 });
}
