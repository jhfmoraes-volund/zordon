import { prisma } from "@/lib/prisma";
import { NextRequest, NextResponse } from "next/server";

export async function GET() {
  const sprints = await prisma.sprint.findMany({
    include: {
      project: { select: { id: true, name: true } },
      tasks: {
        select: {
          status: true,
          functionPoints: true,
          assignments: {
            include: {
              member: { select: { id: true, name: true, fpCapacity: true } },
            },
          },
        },
      },
    },
    orderBy: { startDate: "desc" },
  });

  const result = sprints.map(({ tasks, ...sprint }) => {
    const total = tasks.length;
    const done = tasks.filter((t) => t.status === "done").length;
    const totalFp = tasks.reduce((s, t) => s + (t.functionPoints ?? 0), 0);

    const memberMap = new Map<string, { id: string; name: string; fpCapacity: number; fpAllocated: number }>();
    for (const task of tasks) {
      const fp = task.functionPoints ?? 0;
      for (const a of task.assignments) {
        if (a.member) {
          const existing = memberMap.get(a.member.id);
          if (existing) {
            existing.fpAllocated += fp;
          } else {
            memberMap.set(a.member.id, {
              id: a.member.id,
              name: a.member.name,
              fpCapacity: a.member.fpCapacity,
              fpAllocated: fp,
            });
          }
        }
      }
    }

    return {
      ...sprint,
      taskStats: { total, done, percent: total > 0 ? Math.round((done / total) * 100) : 0 },
      totalFp,
      members: Array.from(memberMap.values()),
    };
  });

  return NextResponse.json(result);
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const sprint = await prisma.sprint.create({
    data: body,
    include: {
      project: { select: { id: true, name: true } },
      tasks: { select: { status: true } },
    },
  });

  const total = sprint.tasks.length;
  const done = sprint.tasks.filter((t) => t.status === "done").length;
  const { tasks, ...rest } = sprint;

  return NextResponse.json({
    ...rest,
    taskStats: { total, done, percent: total > 0 ? Math.round((done / total) * 100) : 0 },
    totalFp: 0,
    members: [],
  }, { status: 201 });
}
