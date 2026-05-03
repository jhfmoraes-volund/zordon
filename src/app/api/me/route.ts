import { db } from "@/lib/db";
import { NextResponse } from "next/server";
import { OPEN_STATUSES } from "@/lib/function-points";
import { getCurrentMember, getUser } from "@/lib/dal";

export async function GET() {
  const user = await getUser();
  if (!user) return new NextResponse("Unauthorized", { status: 401 });

  const member = await getCurrentMember();
  if (!member) {
    return NextResponse.json(
      { error: "No member linked to this account" },
      { status: 404 },
    );
  }

  const memberId = member.id;
  const supabase = db();

  // Fetch tasks and project allocations in parallel
  const [assignmentsRes, projectAllocationsRes] = await Promise.all([
    supabase
      .from("TaskAssignment")
      .select(`
        task:Task!inner(
          id, title, reference, status, type,
          functionPoints, dueDate, sprintId, projectId,
          project:Project(name),
          sprint:Sprint(id, name)
        )
      `)
      .eq("memberId", memberId)
      .in("task.status", [...OPEN_STATUSES, "backlog"]),
    supabase
      .from("ProjectMember")
      .select("project:Project(id, name, status)")
      .eq("memberId", memberId),
  ]);

  if (assignmentsRes.error) return NextResponse.json({ error: assignmentsRes.error.message }, { status: 500 });
  if (projectAllocationsRes.error) return NextResponse.json({ error: projectAllocationsRes.error.message }, { status: 500 });

  const tasks = assignmentsRes.data.map((a: any) => a.task);
  const projects = projectAllocationsRes.data.map((pa: any) => pa.project);

  // FP em aberto (open statuses)
  const fpOpen = tasks
    .filter((t: any) => [...OPEN_STATUSES].includes(t.status))
    .reduce((sum: number, t: any) => sum + (t.functionPoints ?? 0), 0);

  // Sprints where I have tasks
  const sprintMap = new Map<string, { id: string; name: string; projectName: string; taskCount: number; fpTotal: number; doneCount: number }>();
  for (const t of tasks) {
    if (!t.sprint) continue;
    const existing = sprintMap.get(t.sprint.id);
    if (existing) {
      existing.taskCount++;
      existing.fpTotal += t.functionPoints ?? 0;
      if (t.status === "done") existing.doneCount++;
    } else {
      sprintMap.set(t.sprint.id, {
        id: t.sprint.id,
        name: t.sprint.name,
        projectName: t.project.name,
        taskCount: 1,
        fpTotal: t.functionPoints ?? 0,
        doneCount: t.status === "done" ? 1 : 0,
      });
    }
  }

  return NextResponse.json({
    member: {
      id: member.id,
      name: member.name,
      role: member.role,
      position: member.position,
      fpCapacity: member.fpCapacity,
    },
    fpOpen,
    tasks,
    sprints: Array.from(sprintMap.values()),
    projects,
  });
}
