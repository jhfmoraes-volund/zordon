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

  const [projectRes, sprintsRes] = await Promise.all([
    supabase.from("Project").select("id, name, startDate, endDate").eq("id", id).maybeSingle(),
    supabase.from("Sprint")
      .select(`
        *,
        tasks:Task(
          id, title, reference, status, type, functionPoints, dueDate,
          assignments:TaskAssignment(*, member:Member(id, name))
        )
      `)
      .eq("projectId", id)
      .order("startDate"),
  ]);

  if (!projectRes.data) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const schedule = (sprintsRes.data ?? []).map((sprint: any) => {
    let totalFp = 0;
    let tasksDone = 0;

    // Sort tasks by dueDate asc, priority desc
    const sortedTasks = [...sprint.tasks].sort((a: any, b: any) => {
      if (a.dueDate && b.dueDate) return new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime();
      if (a.dueDate) return -1;
      if (b.dueDate) return 1;
      return (b.priority ?? 0) - (a.priority ?? 0);
    });

    const tasks = sortedTasks.map((task: any) => {
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
        assignees: task.assignments.map((a: any) => a.member?.name).filter(Boolean),
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
        .filter((t: any) => t.status === "done")
        .reduce((s: number, t: any) => s + (t.functionPoints ?? 0), 0),
      tasks,
    };
  });

  return NextResponse.json({ project: projectRes.data, schedule });
}
