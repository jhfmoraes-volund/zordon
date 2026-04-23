import { db } from "@/lib/db";
import { NextRequest, NextResponse } from "next/server";
import { getUser } from "@/lib/dal";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getUser();
  if (!user) return new NextResponse("Unauthorized", { status: 401 });

  const { id } = await params;
  const supabase = db();

  const { data: member } = await supabase
    .from("Member")
    .select("id, name, fpCapacity")
    .eq("id", id)
    .maybeSingle();

  if (!member) {
    return NextResponse.json({ error: "Member not found" }, { status: 404 });
  }

  const { data: assignments, error } = await supabase
    .from("TaskAssignment")
    .select(`
      task:Task!inner(
        functionPoints, status, sprintId,
        sprint:Sprint!inner(
          id, name, startDate, endDate, status, projectId,
          project:Project(name)
        )
      )
    `)
    .eq("memberId", id)
    .not("task.sprintId", "is", null);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const sprintMap = new Map<
    string,
    {
      sprintId: string;
      sprintName: string;
      startDate: string;
      endDate: string;
      sprintStatus: string;
      projects: Map<string, { projectId: string; projectName: string; fp: number }>;
      totalFp: number;
    }
  >();

  for (const a of assignments as any[]) {
    const sprint = a.task.sprint;
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
    .sort((a, b) => new Date(a.startDate).getTime() - new Date(b.startDate).getTime())
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
