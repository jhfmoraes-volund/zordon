import { prisma } from "@/lib/prisma";
import { NextRequest, NextResponse } from "next/server";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  const project = await prisma.project.findUnique({
    where: { id },
    select: { id: true, name: true, startDate: true, endDate: true },
  });

  if (!project) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const sprints = await prisma.sprint.findMany({
    where: { projectId: id },
    include: {
      tasks: {
        select: {
          id: true, title: true, reference: true, status: true,
          type: true, functionPoints: true, dueDate: true, executionMode: true,
          assignments: {
            include: {
              member: { select: { id: true, name: true } },
              agent: { select: { id: true, name: true } },
            },
          },
        },
        orderBy: [{ dueDate: "asc" }, { priority: "desc" }],
      },
    },
    orderBy: { startDate: "asc" },
  });

  const schedule = sprints.map((sprint) => {
    let totalFp = 0;
    let tasksDone = 0;

    const tasks = sprint.tasks.map((task) => {
      const fp = task.functionPoints ?? 0;
      totalFp += fp;
      if (task.status === "done") tasksDone++;

      return {
        id: task.id,
        reference: task.reference,
        title: task.title,
        status: task.status,
        type: task.type,
        functionPoints: task.functionPoints,
        dueDate: task.dueDate,
        executionMode: task.executionMode,
        assignees: task.assignments.map((a) => a.member?.name || a.agent?.name).filter(Boolean),
      };
    });

    return {
      id: sprint.id,
      name: sprint.name,
      startDate: sprint.startDate,
      endDate: sprint.endDate,
      status: sprint.status,
      totalTasks: sprint.tasks.length,
      tasksDone,
      totalFp,
      fpDone: sprint.tasks
        .filter((t) => t.status === "done")
        .reduce((s, t) => s + (t.functionPoints ?? 0), 0),
      tasks,
    };
  });

  return NextResponse.json({ project, schedule });
}
