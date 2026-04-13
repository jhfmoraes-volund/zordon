import { prisma } from "@/lib/prisma";
import { NextRequest, NextResponse } from "next/server";
import { suggestFunctionPoints } from "@/lib/function-points";

export async function GET(req: NextRequest) {
  const sprintId = req.nextUrl.searchParams.get("sprintId");
  const projectId = req.nextUrl.searchParams.get("projectId");

  const where: Record<string, string> = {};
  if (sprintId) where.sprintId = sprintId;
  if (projectId) where.projectId = projectId;

  const tasks = await prisma.task.findMany({
    where,
    include: {
      project: { select: { name: true } },
      sprint: { select: { name: true } },
      assignments: {
        include: {
          member: { select: { name: true } },
          agent: { select: { name: true } },
        },
      },
      _count: { select: { iterations: true } },
    },
    orderBy: [{ priority: "desc" }, { createdAt: "desc" }],
  });
  return NextResponse.json(tasks);
}

export async function POST(req: NextRequest) {
  const { assigneeIds, ...data } = await req.json();

  // Auto-suggest FP if not provided
  if (data.functionPoints === undefined || data.functionPoints === null) {
    data.functionPoints = suggestFunctionPoints(
      data.scope || "small",
      data.complexity || "medium"
    );
  }

  const task = await prisma.task.create({
    data: {
      ...data,
      assignments: assigneeIds?.length
        ? {
            create: assigneeIds.map((a: { memberId?: string; agentId?: string }) => a),
          }
        : undefined,
    },
    include: {
      project: { select: { name: true } },
      assignments: {
        include: {
          member: { select: { name: true } },
          agent: { select: { name: true } },
        },
      },
    },
  });

  return NextResponse.json(task, { status: 201 });
}
