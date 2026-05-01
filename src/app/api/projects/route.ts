import { db } from "@/lib/db";
import { NextRequest, NextResponse } from "next/server";
import { getUser } from "@/lib/dal";
import { getNextSprintDefaults } from "@/lib/sprint-dates";

export async function GET() {
  const user = await getUser();
  if (!user) return new NextResponse("Unauthorized", { status: 401 });

  const supabase = db();

  const { data: projects, error } = await supabase
    .from("Project")
    .select(`
      *,
      client:Client(name),
      projectMembers:ProjectMember(*, member:Member(id, name, role)),
      pm:Member!Project_pmId_fkey(id, name)
    `)
    .order("createdAt", { ascending: false });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Add _count.tasks per project
  const projectIds = (projects ?? []).map((p) => p.id);
  let taskCounts: Record<string, number> = {};
  if (projectIds.length > 0) {
    const { data: tasks } = await supabase
      .from("Task")
      .select("projectId")
      .in("projectId", projectIds)
      .neq("status", "draft");
    if (tasks) {
      for (const t of tasks) {
        taskCounts[t.projectId] = (taskCounts[t.projectId] ?? 0) + 1;
      }
    }
  }

  const result = (projects ?? []).map((p) => ({
    ...p,
    _count: { tasks: taskCounts[p.id] ?? 0 },
  }));

  return NextResponse.json(result);
}

export async function POST(req: NextRequest) {
  const user = await getUser();
  if (!user) return new NextResponse("Unauthorized", { status: 401 });

  const { memberIds, ...data } = await req.json();
  const supabase = db();

  const { data: project, error } = await supabase
    .from("Project")
    .insert({ id: crypto.randomUUID(), updatedAt: new Date().toISOString(), ...data })
    .select()
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  if (memberIds?.length) {
    await supabase
      .from("ProjectMember")
      .insert(memberIds.map((memberId: string) => ({ id: crypto.randomUUID(), projectId: project.id, memberId })));
  }

  // Invariante: todo projeto começa com pelo menos uma sprint.
  // CHECK constraint sprint_week_invariant garante seg→dom no DB.
  const sprintDefaults = getNextSprintDefaults([]);
  await supabase.from("Sprint").insert({
    id: crypto.randomUUID(),
    projectId: project.id,
    name: sprintDefaults.name,
    startDate: sprintDefaults.startDate,
    endDate: sprintDefaults.endDate,
    status: "planning",
    updatedAt: new Date().toISOString(),
  });

  const { data: full } = await supabase
    .from("Project")
    .select("*, projectMembers:ProjectMember(*, member:Member(id, name, role))")
    .eq("id", project.id)
    .single();

  return NextResponse.json(full, { status: 201 });
}
