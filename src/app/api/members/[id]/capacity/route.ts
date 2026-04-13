import { prisma } from "@/lib/prisma";
import { NextRequest, NextResponse } from "next/server";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  const member = await prisma.member.findUnique({
    where: { id },
    select: { id: true, name: true, fpCapacity: true },
  });

  if (!member) {
    return NextResponse.json({ error: "Member not found" }, { status: 404 });
  }

  const assignments = await prisma.taskAssignment.findMany({
    where: { memberId: id, task: { sprintId: { not: null } } },
    include: {
      task: {
        select: {
          functionPoints: true,
          status: true,
          sprintId: true,
          sprint: {
            select: {
              id: true, name: true, startDate: true, endDate: true,
              status: true, projectId: true,
              project: { select: { name: true } },
            },
          },
        },
      },
    },
  });

  const sprintMap = new Map<
    string,
    {
      sprintId: string;
      sprintName: string;
      startDate: Date;
      endDate: Date;
      sprintStatus: string;
      projects: Map<string, { projectId: string; projectName: string; fp: number }>;
      totalFp: number;
    }
  >();

  for (const a of assignments) {
    const sprint = a.task.sprint!;
    const fp = a.task.functionPoints ?? 0;

    if (!sprintMap.has(sprint.id)) {
      sprintMap.set(sprint.id, {
        sprintId: sprint.id,
        sprintName: sprint.name,
        startDate: sprint.startDate,
        endDate: sprint.endDate,
        sprintStatus: sprint.status,
        projects: new Map(),
        totalFp: 0,
      });
    }

    const entry = sprintMap.get(sprint.id)!;
    entry.totalFp += fp;

    if (!entry.projects.has(sprint.projectId)) {
      entry.projects.set(sprint.projectId, {
        projectId: sprint.projectId,
        projectName: sprint.project.name,
        fp: 0,
      });
    }
    entry.projects.get(sprint.projectId)!.fp += fp;
  }

  const sprints = Array.from(sprintMap.values())
    .sort((a, b) => a.startDate.getTime() - b.startDate.getTime())
    .map(({ projects, ...rest }) => ({
      ...rest,
      projects: Array.from(projects.values()),
      usage: member.fpCapacity > 0 ? rest.totalFp / member.fpCapacity : 0,
    }));

  return NextResponse.json({
    member: { id: member.id, name: member.name, fpCapacity: member.fpCapacity },
    sprints,
  });
}
