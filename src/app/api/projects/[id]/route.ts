import { db } from "@/lib/db";
import { NextRequest, NextResponse } from "next/server";
import { ACTIVE_STATUSES } from "@/lib/function-points";
import { getUser } from "@/lib/dal";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getUser();
  if (!user) return new NextResponse("Unauthorized", { status: 401 });

  const { id } = await params;
  const supabase = db();

  // Decompose the mega-include into parallel queries
  const [
    projectRes,
    squadsRes,
    membersRes,
    sprintsRes,
    tasksRes,
    sessionsRes,
  ] = await Promise.all([
    supabase.from("Project").select("*, client:Client(*)").eq("id", id).maybeSingle(),
    supabase.from("ProjectSquad").select("*, squad:Squad(*, members:SquadMember(*, member:Member(*)))").eq("projectId", id),
    supabase.from("ProjectMember").select("*, member:Member(id, name, role, fpCapacity)").eq("projectId", id),
    supabase.from("Sprint").select("*, tasks:Task(status, functionPoints, dueDate)").eq("projectId", id).order("startDate", { ascending: false }),
    supabase.from("Task").select("*, assignments:TaskAssignment(*, member:Member(id, name, role, fpCapacity)), sprint:Sprint(name)").eq("projectId", id).neq("status", "draft").order("priority", { ascending: false }).order("createdAt", { ascending: false }),
    // View doesn't have FK relationships — query without joins
    supabase.from("design_session_summary").select("*").eq("projectId", id).order("createdAt", { ascending: false }),
  ]);

  // Check for errors in any query
  const queryErrors = [
    projectRes.error && `project: ${projectRes.error.message}`,
    squadsRes.error && `squads: ${squadsRes.error.message}`,
    membersRes.error && `members: ${membersRes.error.message}`,
    sprintsRes.error && `sprints: ${sprintsRes.error.message}`,
    tasksRes.error && `tasks: ${tasksRes.error.message}`,
    sessionsRes.error && `sessions: ${sessionsRes.error.message}`,
  ].filter(Boolean);

  if (queryErrors.length > 0) {
    console.error("[GET /api/projects/[id]] query errors:", queryErrors);
    return NextResponse.json({ error: queryErrors.join("; ") }, { status: 500 });
  }

  const project = projectRes.data;
  if (!project) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const projectSquads = squadsRes.data ?? [];
  const projectMembers = membersRes.data ?? [];
  const rawSprints = sprintsRes.data ?? [];
  const tasks = tasksRes.data ?? [];
  const designSessions = (sessionsRes.data ?? []).map((s: any) => ({
    ...s,
    _count: { items: s.item_count },
  }));

  // ─── Sprint stats ──────────────────────────────────────
  const sprints = rawSprints.map(({ tasks: sprintTasks, ...sprint }: any) => {
    const total = sprintTasks.length;
    const done = sprintTasks.filter((t: any) => t.status === "done").length;
    const totalFp = sprintTasks.reduce((s: number, t: any) => s + (t.functionPoints ?? 0), 0);
    const fpDone = sprintTasks.filter((t: any) => t.status === "done").reduce((s: number, t: any) => s + (t.functionPoints ?? 0), 0);
    return {
      ...sprint,
      taskStats: { total, done, percent: total > 0 ? Math.round((done / total) * 100) : 0 },
      totalFp,
      fpDone,
    };
  });

  // ─── Task summary ──────────────────────────────────────
  const taskSummary = {
    total: tasks.length,
    backlog: tasks.filter((t) => t.status === "backlog").length,
    todo: tasks.filter((t) => t.status === "todo").length,
    in_progress: tasks.filter((t) => t.status === "in_progress").length,
    review: tasks.filter((t) => t.status === "review").length,
    done: tasks.filter((t) => t.status === "done").length,
  };

  // ─── Project health ────────────────────────────────────
  const now = new Date();
  const startDate = rawSprints.length > 0
    ? rawSprints.reduce((min: string, s: any) => s.startDate < min ? s.startDate : min, rawSprints[0].startDate)
    : null;

  const totalTasks = tasks.length;
  const doneTasks = tasks.filter((t) => t.status === "done").length;
  const progressPercent = totalTasks > 0 ? Math.round((doneTasks / totalTasks) * 100) : 0;
  const totalFp = tasks.reduce((s, t) => s + (t.functionPoints ?? 0), 0);
  const doneFp = tasks.filter((t) => t.status === "done").reduce((s, t) => s + (t.functionPoints ?? 0), 0);

  const overdueTasks = tasks.filter(
    (t) => t.dueDate && new Date(t.dueDate) < now && t.status !== "done"
  );

  const activeSprint = sprints.find((s: any) => s.status === "active");
  let sprintBehind = false;
  if (activeSprint) {
    const sprintStart = new Date(activeSprint.startDate).getTime();
    const sprintEnd = new Date(activeSprint.endDate).getTime();
    const elapsed = (now.getTime() - sprintStart) / (sprintEnd - sprintStart);
    const expectedPercent = Math.min(elapsed * 100, 100);
    sprintBehind = activeSprint.taskStats.percent < expectedPercent - 20;
  }

  const deadlineClose = project.endDate
    ? (new Date(project.endDate).getTime() - now.getTime()) < 7 * 86400000 && progressPercent < 80
    : false;

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
  const allMemberIds = projectMembers.map((pm: any) => pm.member.id);

  let fpByMember = new Map<string, number>();
  if (allMemberIds.length > 0) {
    const { data: allAssignments } = await supabase
      .from("TaskAssignment")
      .select("memberId, task:Task!inner(functionPoints, status)")
      .in("memberId", allMemberIds)
      .in("task.status", [...ACTIVE_STATUSES]);

    for (const a of (allAssignments ?? []) as any[]) {
      if (!a.memberId) continue;
      const fp = a.task.functionPoints ?? 0;
      fpByMember.set(a.memberId, (fpByMember.get(a.memberId) ?? 0) + fp);
    }
  }

  const members = projectMembers.map((pm: any) => {
    const member = pm.member;
    const fpThisProject = tasks
      .filter((t) =>
        [...ACTIVE_STATUSES].includes(t.status as any) &&
        (t as any).assignments.some((a: any) => a.member?.id === member.id)
      )
      .reduce((s, t) => s + (t.functionPoints ?? 0), 0);

    const fpTotal = fpByMember.get(member.id) ?? 0;
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
  });

  const overloadedMembers = members.filter((m) => m.isOverloaded);
  if (overloadedMembers.length > 0) {
    if (attentionLevel === "low") attentionLevel = "medium";
    if (attentionLevel === "medium" && overloadedMembers.some((m) => m.totalPct > 1)) {
      attentionLevel = "high";
    }
    attentionReasons.push(
      `${overloadedMembers.length} membro${overloadedMembers.length > 1 ? "s" : ""} com carga acima de 85%`
    );
  }

  return NextResponse.json({
    ...project,
    projectSquads,
    projectMembers,
    sprints,
    tasks,
    designSessions,
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
  const user = await getUser();
  if (!user) return new NextResponse("Unauthorized", { status: 401 });

  const { id } = await params;
  const { memberIds, ...data } = await req.json();
  const supabase = db();

  if (memberIds !== undefined) {
    await supabase.from("ProjectMember").delete().eq("projectId", id);
    if (memberIds.length > 0) {
      await supabase
        .from("ProjectMember")
        .insert(memberIds.map((memberId: string) => ({ id: crypto.randomUUID(), projectId: id, memberId })));
    }
  }

  await supabase.from("Project").update(data).eq("id", id);

  const { data: project, error } = await supabase
    .from("Project")
    .select("*, projectMembers:ProjectMember(*, member:Member(id, name, role))")
    .eq("id", id)
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json(project);
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getUser();
  if (!user) return new NextResponse("Unauthorized", { status: 401 });

  const { id } = await params;
  const { error } = await db().from("Project").delete().eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
