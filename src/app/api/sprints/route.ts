import { db } from "@/lib/db";
import { NextRequest, NextResponse } from "next/server";
import { getUser } from "@/lib/dal";
import { requireCapabilityApi } from "@/lib/access/require-capability";
import { isGuestActor } from "@/lib/guest-payload";

export async function GET(req: NextRequest) {
  const user = await getUser();
  if (!user) return new NextResponse("Unauthorized", { status: 401 });

  const { searchParams } = new URL(req.url);
  const statusParam = searchParams.get("status");
  const projectIdParam = searchParams.get("projectId");
  const supabase = db();

  let query = supabase
    .from("Sprint")
    .select(`
      *,
      project:Project(id, name),
      tasks:Task(
        status, functionPoints,
        assignments:TaskAssignment(
          member:Member(id, name, fpCapacity)
        )
      )
    `)
    .order("startDate", { ascending: false });

  if (statusParam !== "all") {
    const statuses = statusParam ? [statusParam] : ["active", "upcoming"];
    query = query.in("status", statuses);
  }

  if (projectIdParam) {
    query = query.eq("projectId", projectIdParam);
  }

  const { data: sprints, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  type SprintTask = { status: string; functionPoints: number | null; assignments: { member: { id: string; name: string; fpCapacity: number } | null }[] };
  const result = (sprints ?? []).map(({ tasks, ...sprint }: { tasks: SprintTask[] } & Record<string, unknown>) => {
    const total = tasks.length;
    const done = tasks.filter((t) => t.status === "done").length;
    // totalFp = planejado da sprint (status ≠ backlog), alinhado com fp_planned da view
    const totalFp = tasks
      .filter((t) => t.status !== "backlog")
      .reduce((s: number, t) => s + (t.functionPoints ?? 0), 0);

    const memberMap = new Map<string, { id: string; name: string; fpCapacity: number; fpPlanned: number }>();
    for (const task of tasks) {
      if (task.status === "backlog") continue;
      const fp = task.functionPoints ?? 0;
      for (const a of task.assignments) {
        if (a.member) {
          const existing = memberMap.get(a.member.id);
          if (existing) {
            existing.fpPlanned += fp;
          } else {
            memberMap.set(a.member.id, {
              id: a.member.id,
              name: a.member.name,
              fpCapacity: a.member.fpCapacity,
              fpPlanned: fp,
            });
          }
        }
      }
    }

    return {
      ...sprint,
      taskStats: { total, done, percent: total > 0 ? Math.round((done / total) * 100) : 0 },
      totalFp,
      members: Array.from(memberMap.values()),
    };
  });

  const guest = await isGuestActor();
  const safe = guest
    ? result.map((s) => ({
        ...s,
        totalFp: null,
        members: s.members.map((m: { id: string; name: string; fpCapacity: number; fpPlanned: number }) => ({
          ...m,
          fpCapacity: null,
          fpPlanned: null,
        })),
      }))
    : result;
  return NextResponse.json(safe);
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  if (!body?.projectId) {
    return NextResponse.json({ error: "projectId obrigatório" }, { status: 400 });
  }
  // Criar sprint: manager (qualquer projeto) ou contributor+ no projeto.
  const denied = await requireCapabilityApi("sprint.write", {
    projectId: body.projectId,
  });
  if (denied) return denied;

  const supabase = db();

  const { data: sprint, error } = await supabase
    .from("Sprint")
    .insert({ id: crypto.randomUUID(), updatedAt: new Date().toISOString(), ...body })
    .select("*, project:Project(id, name)")
    .single();
  if (error) {
    if (error.code === "23505") {
      const msg = error.message.includes("sprint_unique_week_per_project")
        ? "Já existe um sprint nessa semana neste projeto."
        : "Já existe um sprint com esse nome neste projeto.";
      return NextResponse.json({ error: msg }, { status: 409 });
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({
    ...sprint,
    taskStats: { total: 0, done: 0, percent: 0 },
    totalFp: 0,
    members: [],
  }, { status: 201 });
}
