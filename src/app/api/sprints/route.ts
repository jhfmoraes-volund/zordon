import { db } from "@/lib/db";
import { NextRequest, NextResponse } from "next/server";
import { getUser } from "@/lib/dal";

export async function GET(req: NextRequest) {
  const user = await getUser();
  if (!user) return new NextResponse("Unauthorized", { status: 401 });

  const { searchParams } = new URL(req.url);
  const statusParam = searchParams.get("status");
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
    const statuses = statusParam ? [statusParam] : ["active", "planning"];
    query = query.in("status", statuses);
  }

  const { data: sprints, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const result = (sprints ?? []).map(({ tasks, ...sprint }: any) => {
    const total = tasks.length;
    const done = tasks.filter((t: any) => t.status === "done").length;
    const totalFp = tasks.reduce((s: number, t: any) => s + (t.functionPoints ?? 0), 0);

    const memberMap = new Map<string, { id: string; name: string; fpCapacity: number; fpAllocated: number }>();
    for (const task of tasks) {
      const fp = task.functionPoints ?? 0;
      for (const a of task.assignments) {
        if (a.member) {
          const existing = memberMap.get(a.member.id);
          if (existing) {
            existing.fpAllocated += fp;
          } else {
            memberMap.set(a.member.id, {
              id: a.member.id,
              name: a.member.name,
              fpCapacity: a.member.fpCapacity,
              fpAllocated: fp,
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

  return NextResponse.json(result);
}

export async function POST(req: NextRequest) {
  const user = await getUser();
  if (!user) return new NextResponse("Unauthorized", { status: 401 });

  const body = await req.json();
  const supabase = db();

  const { data: sprint, error } = await supabase
    .from("Sprint")
    .insert({ id: crypto.randomUUID(), updatedAt: new Date().toISOString(), ...body })
    .select("*, project:Project(id, name)")
    .single();
  if (error) {
    if (error.code === "23505") {
      return NextResponse.json(
        { error: "Já existe um sprint com esse nome neste projeto." },
        { status: 409 },
      );
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
