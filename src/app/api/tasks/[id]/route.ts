import { prisma } from "@/lib/prisma";
import { NextRequest, NextResponse } from "next/server";
import { canTransition } from "@/lib/task-status";

const TASK_INCLUDE = {
  project: { select: { name: true } },
  sprint: { select: { name: true } },
  assignments: {
    include: {
      member: { select: { id: true, name: true } },
      agent: { select: { id: true, name: true } },
    },
  },
  iterations: {
    orderBy: { startedAt: "desc" as const },
    select: {
      id: true,
      number: true,
      type: true,
      trigger: true,
      resultSummary: true,
      success: true,
      startedAt: true,
      completedAt: true,
    },
  },
  _count: { select: { iterations: true } },
};

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const task = await prisma.task.findUnique({
    where: { id },
    include: TASK_INCLUDE,
  });
  if (!task) {
    return NextResponse.json({ error: "Task not found" }, { status: 404 });
  }
  return NextResponse.json(task);
}

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const { assigneeIds, ...data } = await req.json();

  const current = await prisma.task.findUnique({ where: { id } });
  if (!current) {
    return NextResponse.json({ error: "Task not found" }, { status: 404 });
  }

  // Validate status transition
  if (data.status && data.status !== current.status) {
    if (!canTransition(current.status, data.status)) {
      return NextResponse.json(
        { error: `Invalid status transition: ${current.status} → ${data.status}` },
        { status: 400 }
      );
    }
  }

  // Handle assignment updates
  if (assigneeIds !== undefined) {
    await prisma.taskAssignment.deleteMany({ where: { taskId: id } });
    if (assigneeIds.length > 0) {
      await prisma.taskAssignment.createMany({
        data: assigneeIds.map((a: { memberId?: string; agentId?: string }) => ({
          taskId: id,
          ...a,
        })),
      });
    }
  }

  const task = await prisma.task.update({
    where: { id },
    data,
    include: TASK_INCLUDE,
  });

  return NextResponse.json(task);
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  await prisma.task.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
