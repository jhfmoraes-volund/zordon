/**
 * GET /api/projects/[id]/plannings
 * Lista resumida das PlanningCeremony de um projeto — alimenta o tab Cerimônias.
 * Inclui contagens (meetings/transcripts/notes/pendingActions).
 */
import { NextRequest, NextResponse } from "next/server";
import { requireProjectViewApi } from "@/lib/dal";
import { listPlanningsForProject } from "@/lib/dal/planning";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const denied = await requireProjectViewApi(id);
  if (denied) return denied;

  const plannings = await listPlanningsForProject(id);
  return NextResponse.json(plannings);
}
