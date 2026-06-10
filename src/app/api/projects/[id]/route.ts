import { db } from "@/lib/db";
import { NextRequest, NextResponse } from "next/server";
import { headers } from "next/headers";
import { OPEN_STATUSES } from "@/lib/function-points";
import { getUser } from "@/lib/dal";
import { isGuestActor } from "@/lib/guest-payload";

// ─── Row types (boundary casts — evita `any`, espelha operacao-view) ───────

type SprintTaskLite = {
  status: string;
  functionPoints: number | null;
  dueDate: string | null;
};
type SprintRow = {
  id: string;
  name: string;
  startDate: string;
  endDate: string;
  status: string;
  [key: string]: unknown;
};
type TaskAssignmentLite = {
  member: { id: string; name?: string; fpCapacity?: number | null } | null;
  [key: string]: unknown;
};
type TaskRow = {
  status: string;
  functionPoints: number | null;
  dueDate: string | null;
  assignments: TaskAssignmentLite[];
  [key: string]: unknown;
};
type DesignSessionRow = {
  visibility: string | null;
  item_count: number;
  [key: string]: unknown;
};
type ProjectMemberRow = {
  fpAllocation: number | null;
  member: {
    id: string;
    name: string;
    role: string;
    position: string | null;
    fpCapacity: number;
  };
  [key: string]: unknown;
};

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
    supabase.from("ProjectMember").select("*, member:Member(id, name, role, position, fpCapacity)").eq("projectId", id),
    supabase.from("Sprint").select("*, tasks:Task(status, functionPoints, dueDate)").eq("projectId", id).order("startDate", { ascending: false }),
    supabase.from("Task").select("*, assignments:TaskAssignment(*, member:Member(id, name, role, position, fpCapacity)), sprint:Sprint(name)").eq("projectId", id).neq("status", "draft").is("dismissedAt", null).order("priority", { ascending: false }).order("createdAt", { ascending: false }),
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
  const projectMembers = (membersRes.data ?? []) as unknown as ProjectMemberRow[];
  const rawSprints = (sprintsRes.data ?? []) as unknown as Array<
    SprintRow & { tasks: SprintTaskLite[] }
  >;
  const tasks = (tasksRes.data ?? []) as unknown as TaskRow[];
  const designSessions = ((sessionsRes.data ?? []) as unknown as DesignSessionRow[]).map(
    (s) => ({
      ...s,
      _count: { items: s.item_count },
    }),
  );

  // ─── Sprint stats ──────────────────────────────────────
  const sprints = rawSprints.map(({ tasks: sprintTasks, ...sprint }) => {
    const total = sprintTasks.length;
    const done = sprintTasks.filter((t) => t.status === "done").length;
    const totalFp = sprintTasks.reduce((s, t) => s + (t.functionPoints ?? 0), 0);
    const fpDone = sprintTasks.filter((t) => t.status === "done").reduce((s, t) => s + (t.functionPoints ?? 0), 0);
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
    ? rawSprints.reduce((min, s) => (s.startDate < min ? s.startDate : min), rawSprints[0].startDate)
    : null;

  const totalTasks = tasks.length;
  const doneTasks = tasks.filter((t) => t.status === "done").length;
  const progressPercent = totalTasks > 0 ? Math.round((doneTasks / totalTasks) * 100) : 0;
  const totalFp = tasks.reduce((s, t) => s + (t.functionPoints ?? 0), 0);
  const doneFp = tasks.filter((t) => t.status === "done").reduce((s, t) => s + (t.functionPoints ?? 0), 0);

  const overdueTasks = tasks.filter(
    (t) => t.dueDate && new Date(t.dueDate) < now && t.status !== "done"
  );

  const activeSprint = sprints.find((s) => s.status === "active");
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
  const allMemberIds = projectMembers.map((pm) => pm.member.id);
  const activeSprintIds = sprints
    .filter((s) => s.status === "active" || s.status === "upcoming")
    .map((s) => s.id);

  const fpByMember = new Map<string, number>();
  const allocationOtherByMember = new Map<string, number>();
  const planByMember = new Map<string, { planned: number; done: number; open: number }>();
  if (allMemberIds.length > 0) {
    const [assignmentsRes, allocationsRes, sprintCapsRes] = await Promise.all([
      supabase
        .from("TaskAssignment")
        .select("memberId, task:Task!inner(functionPoints, status)")
        .in("memberId", allMemberIds)
        .in("task.status", [...OPEN_STATUSES]),
      supabase
        .from("ProjectMember")
        .select("memberId, fpAllocation, projectId")
        .in("memberId", allMemberIds)
        .neq("projectId", id),
      activeSprintIds.length > 0
        ? supabase
            .from("sprint_member_capacity")
            .select("memberId, fp_planned, fp_done, fp_open")
            .in("sprintId", activeSprintIds)
        : Promise.resolve({ data: [] }),
    ]);

    const assignmentRows = (assignmentsRes.data ?? []) as unknown as Array<{
      memberId: string | null;
      task: { functionPoints: number | null; status: string };
    }>;
    for (const a of assignmentRows) {
      if (!a.memberId) continue;
      const fp = a.task.functionPoints ?? 0;
      fpByMember.set(a.memberId, (fpByMember.get(a.memberId) ?? 0) + fp);
    }
    const allocationRows = (allocationsRes.data ?? []) as unknown as Array<{
      memberId: string | null;
      fpAllocation: number | null;
    }>;
    for (const a of allocationRows) {
      if (!a.memberId) continue;
      const fp = a.fpAllocation ?? 0;
      allocationOtherByMember.set(
        a.memberId,
        (allocationOtherByMember.get(a.memberId) ?? 0) + fp,
      );
    }
    const capRows = (sprintCapsRes.data ?? []) as unknown as Array<{
      memberId: string | null;
      fp_planned: number | null;
      fp_done: number | null;
      fp_open: number | null;
    }>;
    for (const r of capRows) {
      if (!r.memberId) continue;
      const existing = planByMember.get(r.memberId);
      if (existing) {
        existing.planned += r.fp_planned ?? 0;
        existing.done += r.fp_done ?? 0;
        existing.open += r.fp_open ?? 0;
      } else {
        planByMember.set(r.memberId, {
          planned: r.fp_planned ?? 0,
          done: r.fp_done ?? 0,
          open: r.fp_open ?? 0,
        });
      }
    }
  }

  const members = projectMembers.map((pm) => {
    const member = pm.member;
    const fpThisProject = tasks
      .filter(
        (t) =>
          ([...OPEN_STATUSES] as string[]).includes(t.status) &&
          t.assignments.some((a) => a.member?.id === member.id),
      )
      .reduce((s, t) => s + (t.functionPoints ?? 0), 0);

    const fpTotal = fpByMember.get(member.id) ?? 0;
    const fpOtherProjects = fpTotal - fpThisProject;
    const totalPct = member.fpCapacity > 0 ? fpTotal / member.fpCapacity : 0;
    const isOverloaded = totalPct > 0.85;

    const fpAllocation = pm.fpAllocation ?? 0;
    const fpAllocationOther = allocationOtherByMember.get(member.id) ?? 0;
    const fpAllocationTotal = fpAllocation + fpAllocationOther;

    const plan = planByMember.get(member.id) ?? { planned: 0, done: 0, open: 0 };

    return {
      id: member.id,
      name: member.name,
      role: member.role,
      position: member.position,
      fpCapacity: member.fpCapacity,
      fpThisProject,
      fpOtherProjects,
      fpTotal,
      totalPct,
      isOverloaded,
      fpAllocation,
      fpAllocationOther,
      fpAllocationTotal,
      // Planejado das sprints active+planning desse projeto pra esse membro
      fpPlannedActiveSprints: plan.planned,
      fpDoneActiveSprints: plan.done,
      fpOpenActiveSprints: plan.open,
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

  const h = await headers();
  const viewerRole = h.get("x-user-role");

  const guest = await isGuestActor();

  // Guest: oculta DS internas, zera FP em tasks/sprints/projectMembers/members,
  // omite memberCapacity (relatório interno), e zera FP do health summary.
  const safeDesignSessions = guest
    ? designSessions.filter((s) => s.visibility === "public")
    : designSessions;

  const safeTasks = guest
    ? tasks.map((t) => ({
        ...t,
        functionPoints: null,
        assignments: (t.assignments ?? []).map((a) =>
          a.member
            ? { ...a, member: { ...a.member, fpCapacity: null } }
            : a,
        ),
      }))
    : tasks;

  const safeSprints = guest
    ? sprints.map((s) => ({ ...s, totalFp: null, fpDone: null }))
    : sprints;

  const safeProjectMembers = guest
    ? projectMembers.map((pm) => ({
        ...pm,
        fpAllocation: null,
        member: pm.member ? { ...pm.member, fpCapacity: null } : pm.member,
      }))
    : projectMembers;

  return NextResponse.json({
    ...project,
    projectSquads,
    projectMembers: safeProjectMembers,
    sprints: safeSprints,
    tasks: safeTasks,
    designSessions: safeDesignSessions,
    taskSummary,
    health: {
      startDate,
      progressPercent,
      totalTasks,
      doneTasks,
      totalFp: guest ? null : totalFp,
      doneFp: guest ? null : doneFp,
      attentionLevel,
      attentionReasons,
      overdueCount: overdueTasks.length,
    },
    memberCapacity: guest ? [] : members,
    viewerRole,
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

  // phaseChangedAt marca a entrada na fase atual — alimenta "idade na fase"
  // no Overview. Só estampa quando o patch de fato muda a phase.
  if (data.phase !== undefined) {
    const { data: current } = await supabase
      .from("Project")
      .select("phase")
      .eq("id", id)
      .single();
    if (current && current.phase !== data.phase) {
      data.phaseChangedAt = new Date().toISOString();
    }
  }

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
    .select("*, projectMembers:ProjectMember(*, member:Member(id, name, role, position))")
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
