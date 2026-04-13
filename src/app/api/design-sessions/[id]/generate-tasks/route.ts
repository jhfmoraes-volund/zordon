import { prisma } from "@/lib/prisma";
import { NextRequest, NextResponse } from "next/server";
import { generateTasksFromSession, type GeneratedTask } from "@/lib/task-generator";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const body = await req.json();

  // Phase 1: Generate tasks preview
  if (!body.confirm) {
    try {
      const tasks = await generateTasksFromSession(id);
      return NextResponse.json({ tasks });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return NextResponse.json({ error: message }, { status: 500 });
    }
  }

  // Phase 2: Confirm and create tasks in the database
  const { tasks } = body as { confirm: true; tasks: GeneratedTask[] };

  const session = await prisma.designSession.findUnique({
    where: { id },
    include: { project: { select: { id: true } } },
  });

  if (!session) {
    return NextResponse.json({ error: "Session not found" }, { status: 404 });
  }

  // Get next task reference number
  const lastTask = await prisma.task.findFirst({
    orderBy: { reference: "desc" },
    select: { reference: true },
  });
  let nextNum = 1;
  if (lastTask) {
    const match = lastTask.reference.match(/TASK-(\d+)/);
    if (match) nextNum = parseInt(match[1]) + 1;
  }

  const createdTasks = [];

  for (const task of tasks) {
    const reference = `TASK-${String(nextNum).padStart(3, "0")}`;
    nextNum++;

    // Create DesignSessionItem
    const item = await prisma.designSessionItem.create({
      data: {
        sessionId: id,
        title: task.title,
        description: task.description,
        type: "feature",
        priority: "must",
        sourceStep: "briefing",
        aiGenerated: true,
      },
    });

    // Create Task with specs
    const created = await prisma.task.create({
      data: {
        title: task.title,
        description: task.description,
        reference,
        status: "backlog",
        complexity: task.complexity,
        scope: task.scope,
        projectId: session.project.id,
        designSessionId: id,
        acceptanceCriteria: JSON.stringify(task.acceptanceCriteria),
        businessContext: task.businessContext,
        technicalNotes: task.technicalNotes,
        outOfScope: JSON.stringify(task.outOfScope),
        uiGuidance: task.uiGuidance,
      },
    });

    createdTasks.push(created);
  }

  return NextResponse.json({
    created: createdTasks.length,
    tasks: createdTasks,
  }, { status: 201 });
}
