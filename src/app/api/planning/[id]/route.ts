/**
 * GET /api/planning/[id]
 * Detalhe completo da PlanningCeremony — usado pelo command center.
 * Inclui meetings/transcripts/notes linkados + contagens (pendingActions).
 *
 * Auth: caller precisa ter acesso ao projeto da planning.
 */
import { NextRequest, NextResponse } from "next/server";
import { requireProjectViewApi } from "@/lib/dal";
import { getPlanningById } from "@/lib/dal/planning";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const planning = await getPlanningById(id);
  if (!planning) {
    return NextResponse.json({ error: "Planning não encontrada" }, { status: 404 });
  }

  const denied = await requireProjectViewApi(planning.projectId);
  if (denied) return denied;

  return NextResponse.json(planning);
}
