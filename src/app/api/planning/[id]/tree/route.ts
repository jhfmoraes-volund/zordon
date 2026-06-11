/**
 * GET /api/planning/[id]/tree
 *
 * Devolve a hierarquia Module → Story → Task no escopo da sprint desta
 * planning + backlog elegível (tasks sem sprint dos mesmos módulos).
 *
 * Caso `planning.sprintId` seja null: retorna árvore vazia (UI mostra o
 * empty state explicando que a planning ainda não tem sprint).
 *
 * Resposta:
 *   {
 *     planningId, projectId, sprintId,
 *     tree: ModuleNode[],
 *     stats: { totalStories, totalTasks, committedTasks, eligibleTasks,
 *              draftTasks, committedFp, eligibleFp, totalFp,
 *              proposedModulesCount, approvedModulesCount }
 *   }
 */
import { NextRequest, NextResponse } from "next/server";
import { requireProjectViewApi } from "@/lib/dal";
import {
  getPlanningById,
  getPendingCreateAnchorStoryIds,
} from "@/lib/dal/planning";
import { buildHierarchyTree } from "@/lib/dal/hierarchy-tree";
import { isGuestActor } from "@/lib/guest-payload";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  const planning = await getPlanningById(id);
  if (!planning) {
    return NextResponse.json(
      { error: "Planning não encontrada" },
      { status: 404 },
    );
  }

  const denied = await requireProjectViewApi(planning.projectId);
  if (denied) return denied;

  // Sem sprint → árvore vazia (o cliente decide como mostrar).
  if (!planning.sprintId) {
    return NextResponse.json({
      planningId: id,
      projectId: planning.projectId,
      sprintId: null,
      tree: [],
      stats: {
        totalStories: 0,
        totalTasks: 0,
        committedTasks: 0,
        eligibleTasks: 0,
        draftTasks: 0,
        totalFp: 0,
        committedFp: 0,
        eligibleFp: 0,
        proposedModulesCount: 0,
        approvedModulesCount: 0,
      },
    });
  }

  const [guest, anchorStoryIds] = await Promise.all([
    isGuestActor(),
    // Stories âncora de propostas create pendentes: renderizam mesmo sem task
    // real, pros ghosts terem esqueleto em projeto sem nada committed.
    getPendingCreateAnchorStoryIds(id),
  ]);

  const { tree, stats } = await buildHierarchyTree({
    projectId: planning.projectId,
    filter: {
      kind: "sprint",
      sprintId: planning.sprintId,
      includeBacklogEligible: true,
      anchorStoryIds,
    },
    includeEmptyModules: false, // Planning só mostra módulos tocados pela sprint
    guest,
  });

  return NextResponse.json({
    planningId: id,
    projectId: planning.projectId,
    sprintId: planning.sprintId,
    tree,
    stats,
  });
}
