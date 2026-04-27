import { db } from "@/lib/db";
import { NextRequest, NextResponse } from "next/server";
import {
  getAllocatedProjectIds,
  getRealRole,
  requireProjectMemberApi,
} from "@/lib/dal";
import { hasMinLevel, MANAGER } from "@/lib/roles";

export async function GET() {
  const role = await getRealRole();
  if (!role) return new NextResponse("Unauthorized", { status: 401 });

  const supabase = db();
  const isManager = hasMinLevel(role, MANAGER);

  // Builder sees only sessions from projects they're allocated to.
  // db() runs as service_role (bypasses RLS), so we filter here.
  let sessionQuery = supabase
    .from("DesignSession")
    .select("*, project:Project(name, client:Client(name))")
    .order("createdAt", { ascending: false });
  if (!isManager) {
    const allocated = await getAllocatedProjectIds();
    if (allocated.length === 0) return NextResponse.json([]);
    sessionQuery = sessionQuery.in("projectId", allocated);
  }

  const [sessionsRes, countsRes] = await Promise.all([
    sessionQuery,
    supabase.from("design_session_summary").select("id, item_count"),
  ]);
  if (sessionsRes.error) return NextResponse.json({ error: sessionsRes.error.message }, { status: 500 });

  // Merge item_count from view into sessions
  const countMap = new Map((countsRes.data ?? []).map((c: any) => [c.id, c.item_count]));
  const result = (sessionsRes.data ?? []).map((s: any) => ({
    ...s,
    _count: { items: countMap.get(s.id) ?? 0 },
  }));

  return NextResponse.json(result);
}

export async function POST(req: NextRequest) {
  const body = await req.json();

  if (!body.projectId) {
    return NextResponse.json({ error: "projectId required" }, { status: 400 });
  }
  const denied = await requireProjectMemberApi(body.projectId);
  if (denied) return denied;

  const totalSteps = body.type === "inception" ? 9 : 5;

  const { data: session, error } = await db()
    .from("DesignSession")
    .insert({ id: crypto.randomUUID(), updatedAt: new Date().toISOString(), ...body, totalSteps })
    .select("*, project:Project(name)")
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json(session, { status: 201 });
}
