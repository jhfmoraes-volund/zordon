import { NextRequest, NextResponse } from "next/server";
import { canEditTasks, canViewProject, requireMinLevelApi } from "@/lib/dal";
import { BUILDER } from "@/lib/roles";
import { db } from "@/lib/db";
import { getPrdById } from "@/lib/dal/product-requirements";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

/**
 * Full detail bundle for rendering <PrdDetail> client-side (in-session sheet).
 * Mirrors what the (now-removed) standalone PRD page loaded server-side:
 * prd + project + modules + personas + recent activity + canEdit.
 */
export async function GET(_req: NextRequest, ctx: RouteContext) {
  const denied = await requireMinLevelApi(BUILDER);
  if (denied) return denied;

  const { id } = await ctx.params;
  const prd = await getPrdById(id);
  if (!prd) return NextResponse.json({ error: "not found" }, { status: 404 });

  if (!(await canViewProject(prd.projectId))) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const supabase = db();
  const [{ data: project }, { data: modules }, { data: personas }, { data: activity }] =
    await Promise.all([
      supabase
        .from("Project")
        .select("id, name, referenceKey")
        .eq("id", prd.projectId)
        .maybeSingle(),
      supabase
        .from("Module")
        .select("id, name")
        .eq("projectId", prd.projectId)
        .order("name"),
      supabase
        .from("ProjectPersona")
        .select("id, name")
        .eq("projectId", prd.projectId)
        .order("name"),
      supabase
        .from("ProductRequirementActivity")
        .select("id, kind, actorAgent, actorMemberId, diff, createdAt")
        .eq("productRequirementId", id)
        .order("createdAt", { ascending: false })
        .limit(10),
    ]);

  if (!project) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  // Resolve actor names for the activity log.
  const actorIds = Array.from(
    new Set(
      (activity ?? [])
        .map((a) => a.actorMemberId)
        .filter((x): x is string => !!x),
    ),
  );
  let actorById = new Map<string, string>();
  if (actorIds.length > 0) {
    const { data: members } = await supabase
      .from("Member")
      .select("id, name")
      .in("id", actorIds);
    actorById = new Map((members ?? []).map((m) => [m.id, m.name]));
  }

  const canEdit = await canEditTasks(prd.projectId);

  return NextResponse.json({
    prd,
    project: { id: project.id, name: project.name },
    modules: modules ?? [],
    personas: personas ?? [],
    activity: (activity ?? []).map((a) => ({
      id: a.id,
      kind: a.kind,
      actorAgent: a.actorAgent,
      actorName: a.actorMemberId ? actorById.get(a.actorMemberId) ?? null : null,
      createdAt: a.createdAt,
    })),
    canEdit,
  });
}
