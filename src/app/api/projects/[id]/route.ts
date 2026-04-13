import { prisma } from "@/lib/prisma";
import { NextRequest, NextResponse } from "next/server";
import { ACTIVE_STATUSES } from "@/lib/function-points";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const project = await prisma.project.findUnique({
    where: { id },
    include: {
      client: true,
      projectSquads: {
        include: {
          squad: {
            include: { members: { include: { member: true } } },
          },
        },
      },
      sprints: {
        include: { tasks: { select: { status: true, functionPoints: true, dueDate: true } } },
        orderBy: { startDate: "desc" },
      },
      tasks: {
        include: {
          assignments: {
            include: {
              member: { select: { id: true, name: true, role: true, fpCapacity: true } },
              agent: { select: { name: true } },
            },
          },
          sprint: { select: { name: true } },
        },
        orderBy: [{ priority: "desc" }, { createdAt: "desc" }],
      },
      designSessions: {
        include: { _count: { select: { items: true } } },
        orderBy: { createdAt: "desc" },
      },
    },
  });
  if (!project) return NextResponse.json({ error: "Not found" }, { status: 404 });

  // ─── Sprint stats ──────────────────────────────────────
  const sprints = project.sprints.map(({ tasks, ...sprint }) => {
    const total = tasks.length;
    const done = tasks.filter((t) => t.status === "done").length;
    const totalFp = tasks.reduce((s, t) => s + (t.functionPoints ?? 0), 0);
    const fpDone = tasks.filter((t) => t.status === "done").reduce((s, t) => s + (t.functionPoints ?? 0), 0);
    return {
      ...sprint,
      taskStats: { total, done, percent: total > 0 ? Math.round((done / total) * 100) : 0 },
      totalFp,
      fpDone,
    };
  });

  // ─── Task summary ──────────────────────────────────────
  const taskSummary = {
    total: project.tasks.length,
    backlog: project.tasks.filter((t) => t.status === "backlog").length,
    todo: project.tasks.filter((t) => t.status === "todo").length,
    in_progress: project.tasks.filter((t) => t.status === "in_progress").length,
    review: project.tasks.filter((t) => t.status === "review").length,
    done: project.tasks.filter((t) => t.status === "done").length,
  };

  // ─── Project health ────────────────────────────────────
  const now = new Date();

  // Start date = earliest sprint start
  const startDate = project.sprints.length > 0
    ? project.sprints.reduce((min, s) => s.startDate < min ? s.startDate : min, project.sprints[0].startDate)
    : null;

  // Progress
  const totalTasks = project.tasks.length;
  const doneTasks = project.tasks.filter((t) => t.status === "done").length;
  const progressPercent = totalTasks > 0 ? Math.round((doneTasks / totalTasks) * 100) : 0;

  const totalFp = project.tasks.reduce((s, t) => s + (t.functionPoints ?? 0), 0);
  const doneFp = project.tasks.filter((t) => t.status === "done").reduce((s, t) => s + (t.functionPoints ?? 0), 0);

  // Overdue tasks
  const overdueTasks = project.tasks.filter(
    (t) => t.dueDate && t.dueDate < now && t.status !== "done"
  );

  // Active sprint behind schedule
  const activeSprint = sprints.find((s) => s.status === "active");
  let sprintBehind = false;
  if (activeSprint) {
    const sprintStart = new Date(activeSprint.startDate).getTime();
    const sprintEnd = new Date(activeSprint.endDate).getTime();
    const elapsed = (now.getTime() - sprintStart) / (sprintEnd - sprintStart);
    const expectedPercent = Math.min(elapsed * 100, 100);
    sprintBehind = activeSprint.taskStats.percent < expectedPercent - 20;
  }

  // Deadline proximity
  const deadlineClose = project.endDate
    ? (new Date(project.endDate).getTime() - now.getTime()) < 7 * 86400000 && progressPercent < 80
    : false;

  // Attention level
  let attentionLevel: "low" | "medium" | "high" | "urgent" = "low";
  const attentionReasons: string[] = [];

  if (deadlineClose) {
    attentionLevel = "urgent";
    attentionReasons.push("Deadline em menos de 7 dias com progresso abaixo de 80%");
  }
  if (overdueTasks.length >= 4) {
    attentionLevel = attentionLevel === "urgent" ? "urgent" : "high";
    attentionReasons.push(`${overdueTasks.length} tasks com prazo vencido`);
  } else if (overdueTasks.length >= 1) {
    if (attentionLevel === "low") attentionLevel = "medium";
    attentionReasons.push(`${overdueTasks.length} task${overdueTasks.length > 1 ? "s" : ""} com prazo vencido`);
  }
  if (sprintBehind) {
    if (attentionLevel === "low") attentionLevel = "medium";
    attentionReasons.push("Sprint ativo atrasado (>20% abaixo do esperado)");
  }

  if (attentionReasons.length === 0) {
    attentionReasons.push("Projeto no ritmo planejado");
  }

  // ─── Member capacity (multi-project) ───────────────────
  // Collect all unique member IDs from this project's squads
  const memberIds = new Set<string>();
  for (const ps of project.projectSquads) {
    for (const sm of ps.squad.members) {
      memberIds.add(sm.member.id);
    }
  }

  // For each member, get their total FP across ALL projects (active tasks)
  const memberCapacity = await Promise.all(
    Array.from(memberIds).map(async (memberId) => {
      const member = await prisma.member.findUnique({
        where: { id: memberId },
        select: { id: true, name: true, role: true, fpCapacity: true },
      });
      if (!member) return null;

      // FP in THIS project
      const fpThisProject = project.tasks
        .filter((t) =>
          [...ACTIVE_STATUSES].includes(t.status as any) &&
          t.assignments.some((a) => a.member?.id === memberId)
        )
        .reduce((s, t) => s + (t.functionPoints ?? 0), 0);

      // FP in ALL projects (total)
      const allAssignments = await prisma.taskAssignment.findMany({
        where: {
          memberId,
          task: { status: { in: [...ACTIVE_STATUSES] } },
        },
        include: { task: { select: { functionPoints: true } } },
      });
      const fpTotal = allAssignments.reduce((s, a) => s + (a.task.functionPoints ?? 0), 0);

      const fpOtherProjects = fpTotal - fpThisProject;
      const totalPct = member.fpCapacity > 0 ? fpTotal / member.fpCapacity : 0;
      const isOverloaded = totalPct > 0.85;

      return {
        id: member.id,
        name: member.name,
        role: member.role,
        fpCapacity: member.fpCapacity,
        fpThisProject,
        fpOtherProjects,
        fpTotal,
        totalPct,
        isOverloaded,
      };
    })
  );

  const members = memberCapacity.filter(Boolean);

  // Check if any member is overloaded — adds to attention
  const overloadedMembers = members.filter((m) => m!.isOverloaded);
  if (overloadedMembers.length > 0) {
    if (attentionLevel === "low") attentionLevel = "medium";
    if (attentionLevel === "medium" && overloadedMembers.some((m) => m!.totalPct > 1)) {
      attentionLevel = "high";
    }
    attentionReasons.push(
      `${overloadedMembers.length} membro${overloadedMembers.length > 1 ? "s" : ""} com carga acima de 85%`
    );
  }

  return NextResponse.json({
    ...project,
    sprints,
    taskSummary,
    health: {
      startDate,
      progressPercent,
      totalTasks,
      doneTasks,
      totalFp,
      doneFp,
      attentionLevel,
      attentionReasons,
      overdueCount: overdueTasks.length,
    },
    memberCapacity: members,
  });
}

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const body = await req.json();
  const project = await prisma.project.update({ where: { id }, data: body });
  return NextResponse.json(project);
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  await prisma.project.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
