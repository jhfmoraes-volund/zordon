import { db } from "@/lib/db";
import { NextRequest, NextResponse } from "next/server";
import { getUser } from "@/lib/dal";
import { OPEN_STATUSES } from "@/lib/function-points";

/**
 * GET /api/squads/[id] — lounge payload: squad + members (with skills) +
 * aggregate "Big Numbers" derived through ProjectSquad → Project → Task/Sprint.
 *
 * All metrics flow through the squad's projects (Squad has no direct children).
 * Capacity is the sum of members' fpCapacity vs. FP allocated to the squad's
 * members on the projects' active sprints.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await getUser();
  if (!user) return new NextResponse("Unauthorized", { status: 401 });

  const { id } = await params;
  const supabase = db();

  const { data: squad, error } = await supabase
    .from("Squad")
    .select(`
      *,
      projectSquads:ProjectSquad(id, project:Project(id, name)),
      members:SquadMember(
        id,
        member:Member(
          id, name, position, specialty, seniority, fpCapacity,
          githubUsername, isExternal, createdAt, onboardedAt,
          skills:MemberSkill(towerKey, score),
          projectMembers:ProjectMember(project:Project(id, name))
        )
      )
    `)
    .eq("id", id)
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!squad) return new NextResponse("Not found", { status: 404 });

  const projectIds = (squad.projectSquads ?? [])
    .map((ps: { project: { id: string } | null }) => ps.project?.id)
    .filter((pid: string | undefined): pid is string => Boolean(pid));

  const memberIds = (squad.members ?? [])
    .map((sm: { member: { id: string } | null }) => sm.member?.id)
    .filter((mid: string | undefined): mid is string => Boolean(mid));

  // Default metrics for an empty squad — avoids querying with empty `.in()`.
  let activeSprintCount = 0;
  let taskOpen = 0;
  let taskTotal = 0;
  let fpDone = 0;
  let fpTotal = 0;
  let fpAllocated = 0;
  // memberId → tasks assigned to them in the squad's active sprints.
  const sprintTasksByMember: Record<string, number> = {};

  if (projectIds.length > 0) {
    const [tasksRes, sprintsRes] = await Promise.all([
      supabase
        .from("Task")
        .select("status, functionPoints")
        .in("projectId", projectIds),
      supabase
        .from("Sprint")
        .select("id, status")
        .in("projectId", projectIds),
    ]);

    const tasks = tasksRes.data ?? [];
    taskTotal = tasks.length;
    for (const t of tasks) {
      const fp = t.functionPoints ?? 0;
      fpTotal += fp;
      if (t.status === "done") fpDone += fp;
      if ((OPEN_STATUSES as readonly string[]).includes(t.status)) taskOpen += 1;
    }

    const activeSprintIds = (sprintsRes.data ?? [])
      .filter((s) => s.status === "active")
      .map((s) => s.id);
    activeSprintCount = activeSprintIds.length;

    // FP allocated this cycle = sum of squad members' allocations on the
    // projects' active sprints.
    if (activeSprintIds.length > 0 && memberIds.length > 0) {
      const { data: allocs } = await supabase
        .from("SprintMember")
        .select("fpAllocation")
        .in("sprintId", activeSprintIds)
        .in("memberId", memberIds);
      fpAllocated = (allocs ?? []).reduce((acc, a) => acc + (a.fpAllocation ?? 0), 0);
    }

    // Per-member task count in the active sprints: TaskAssignment → Task whose
    // sprintId is active. Filtered to the squad's members.
    if (activeSprintIds.length > 0 && memberIds.length > 0) {
      const { data: assignments } = await supabase
        .from("TaskAssignment")
        .select("memberId, task:Task!inner(sprintId)")
        .in("memberId", memberIds)
        .in("task.sprintId", activeSprintIds);
      for (const a of (assignments ?? []) as {
        memberId: string | null;
      }[]) {
        if (a.memberId) {
          sprintTasksByMember[a.memberId] =
            (sprintTasksByMember[a.memberId] ?? 0) + 1;
        }
      }
    }
  }

  const fpCapacity = (squad.members ?? []).reduce(
    (acc: number, sm: { member: { fpCapacity: number } | null }) =>
      acc + (sm.member?.fpCapacity ?? 0),
    0,
  );

  return NextResponse.json({
    squad,
    metrics: {
      projectCount: projectIds.length,
      activeSprintCount,
      taskOpen,
      taskTotal,
      fpDone,
      fpTotal,
      fpAllocated,
      fpCapacity,
    },
    sprintTasksByMember,
  });
}

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getUser();
  if (!user) return new NextResponse("Unauthorized", { status: 401 });

  const { id } = await params;
  const { memberIds, projectIds, ...data } = await req.json();
  const supabase = db();

  // Replace members if provided
  if (memberIds !== undefined) {
    await supabase.from("SquadMember").delete().eq("squadId", id);
    if (memberIds.length > 0) {
      await supabase
        .from("SquadMember")
        .insert(memberIds.map((memberId: string) => ({ id: crypto.randomUUID(), squadId: id, memberId })));
    }
  }

  // Replace project associations if provided
  if (projectIds !== undefined) {
    await supabase.from("ProjectSquad").delete().eq("squadId", id);
    if (projectIds.length > 0) {
      await supabase
        .from("ProjectSquad")
        .insert(projectIds.map((projectId: string) => ({ id: crypto.randomUUID(), squadId: id, projectId })));
    }
  }

  // Update squad + re-fetch with relations
  await supabase.from("Squad").update(data).eq("id", id);
  const { data: squad, error } = await supabase
    .from("Squad")
    .select(`
      *,
      projectSquads:ProjectSquad(*, project:Project(id, name)),
      members:SquadMember(*, member:Member(*))
    `)
    .eq("id", id)
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json(squad);
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getUser();
  if (!user) return new NextResponse("Unauthorized", { status: 401 });

  const { id } = await params;
  const { error } = await db().from("Squad").delete().eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
