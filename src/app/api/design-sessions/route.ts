import { db } from "@/lib/db";
import { NextRequest, NextResponse } from "next/server";
import {
  getAccessibleProjectIds,
  getAccessLevel,
  getActorMemberId,
  getUser,
  requireProjectEditSessionsApi,
} from "@/lib/dal";
import { hasMinAccessLevel } from "@/lib/roles";
import { validateSuperSteps } from "@/lib/design-session-steps";

export async function GET() {
  const user = await getUser();
  if (!user) return new NextResponse("Unauthorized", { status: 401 });

  const supabase = db();
  const accessLevel = await getAccessLevel();
  const isManager = hasMinAccessLevel(accessLevel, "manager");

  // Builder sees only sessions from projects they're allocated to.
  // db() runs as service_role (bypasses RLS), so we filter here.
  let sessionQuery = supabase
    .from("DesignSession")
    .select("*, project:Project(name, client:Client(name))")
    .order("createdAt", { ascending: false });
  if (!isManager) {
    const accessible = await getAccessibleProjectIds();
    if (accessible.length === 0) return NextResponse.json([]);
    sessionQuery = sessionQuery.in("projectId", accessible);
  }

  const [sessionsRes, countsRes] = await Promise.all([
    sessionQuery,
    supabase.from("design_session_summary").select("id, item_count"),
  ]);
  if (sessionsRes.error) return NextResponse.json({ error: sessionsRes.error.message }, { status: 500 });

  // Merge item_count from view into sessions
  const countMap = new Map(
    (countsRes.data ?? []).map((c) => [c.id as string, c.item_count as number]),
  );
  const result = (sessionsRes.data ?? []).map((s) => ({
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
  const denied = await requireProjectEditSessionsApi(body.projectId);
  if (denied) return denied;

  let selectedSteps: string[] | null = null;
  let totalSteps: number;

  if (body.type === "super") {
    const validated = validateSuperSteps(body.selectedSteps);
    if (!validated.ok) {
      return NextResponse.json({ error: validated.error }, { status: 400 });
    }
    selectedSteps = validated.normalized;
    totalSteps = validated.normalized.length;
  } else {
    totalSteps = body.type === "inception" ? 10 : 5;
  }

  const actorMemberId = await getActorMemberId();

  const { data: session, error } = await db()
    .from("DesignSession")
    .insert({
      id: crypto.randomUUID(),
      updatedAt: new Date().toISOString(),
      ...body,
      // Server-side: createdBy sempre o usuário autenticado; facilitator
      // default = creator (cliente pode sobrescrever passando facilitatorId).
      createdBy: actorMemberId,
      facilitatorId: body.facilitatorId ?? actorMemberId,
      totalSteps,
      selectedSteps,
    })
    .select("*, project:Project(name)")
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json(session, { status: 201 });
}
