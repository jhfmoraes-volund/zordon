import { NextRequest, NextResponse } from "next/server";
import { requireSessionAccessApi } from "@/lib/dal";
import { db } from "@/lib/db";
import { isGuestActor } from "@/lib/guest-payload";
import { buildHierarchyTree } from "@/lib/dal/hierarchy-tree";

/**
 * GET /api/design-sessions/[id]/tree
 *
 * Briefing hierarchy organizado como Module → Story → Task. A montagem mora
 * em `buildHierarchyTree` (compartilhado com `/api/planning/[id]/tree`); esta
 * rota só resolve auth, lê o projectId da session, e delega.
 *
 * Stories sem moduleId/proposedModuleName ficam em "(sem módulo)". Tasks sem
 * userStoryId não aparecem (sessions legadas).
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: sessionId } = await params;
  const denied = await requireSessionAccessApi(sessionId);
  if (denied) return denied;

  const supabase = db();

  const { data: session, error: sessErr } = await supabase
    .from("DesignSession")
    .select("id, projectId, status")
    .eq("id", sessionId)
    .single();
  if (sessErr || !session) {
    return NextResponse.json({ error: "Session not found" }, { status: 404 });
  }

  const guest = await isGuestActor();

  const { tree, stats } = await buildHierarchyTree({
    projectId: session.projectId,
    filter: { kind: "design-session", sessionId },
    includeEmptyModules: true, // DS pre-popula todos os módulos do projeto
    guest,
  });

  return NextResponse.json({
    sessionId,
    projectId: session.projectId,
    tree,
    stats: {
      totalStories: stats.totalStories,
      totalTasks: stats.totalTasks,
      draftTasks: stats.draftTasks,
      // DS Briefing usa "totalFp" para PFV de tasks draft (não todas).
      totalFp: guest ? null : draftFpOf(tree),
      proposedModulesCount: stats.proposedModulesCount,
      approvedModulesCount: stats.approvedModulesCount,
    },
  });
}

/** Soma PFV só das tasks com status 'draft' — convenção do BriefingRibbon. */
function draftFpOf(tree: Awaited<ReturnType<typeof buildHierarchyTree>>["tree"]) {
  let s = 0;
  for (const m of tree) {
    for (const story of m.stories) {
      for (const t of story.tasks) {
        if (t.status === "draft") s += t.functionPoints ?? 0;
      }
    }
  }
  return s;
}
