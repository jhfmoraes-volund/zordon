/**
 * GET /api/projects/[id]/pm-reviews
 * Lista PM Reviews de um projeto (ordenado por referenceWeek desc).
 *
 * Auth: caller precisa de view no projeto (qualquer role ProjectAccess).
 */
import { NextRequest, NextResponse } from "next/server";
import { requireProjectViewApi } from "@/lib/dal";
import { listPMReviewsForProject } from "@/lib/dal/pm-review";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: projectId } = await params;
  const denied = await requireProjectViewApi(projectId);
  if (denied) return denied;

  try {
    const items = await listPMReviewsForProject(projectId);
    return NextResponse.json(items);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { error: "Falha ao listar PM Reviews", detail: msg },
      { status: 500 },
    );
  }
}
