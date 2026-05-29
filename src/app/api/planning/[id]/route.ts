/**
 * GET  /api/planning/[id] — detalhe completo
 * PATCH /api/planning/[id] — edita sprint/facilitador/scheduledFor
 * DELETE /api/planning/[id] — apaga (hard) se ainda em planejamento;
 *   arquiva (soft) se já concluída/arquivada (preserva audit trail).
 */
import { NextRequest, NextResponse } from "next/server";
import { requireProjectViewApi, requireProjectEditTasksApi } from "@/lib/dal";
import {
  getPlanningById,
  updatePlanning,
  archivePlanning,
  deletePlanning,
} from "@/lib/dal/planning";

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

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const planning = await getPlanningById(id);
  if (!planning) {
    return NextResponse.json({ error: "Planning não encontrada" }, { status: 404 });
  }

  const denied = await requireProjectEditTasksApi(planning.projectId);
  if (denied) return denied;

  const body = await req.json();
  const { sprintId, facilitatorId, scheduledFor } = body as {
    sprintId?: string | null;
    facilitatorId?: string | null;
    scheduledFor?: string | null;
  };

  const updated = await updatePlanning(id, { sprintId, facilitatorId, scheduledFor });
  return NextResponse.json(updated);
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const planning = await getPlanningById(id);
  if (!planning) {
    return NextResponse.json({ error: "Planning não encontrada" }, { status: 404 });
  }

  const denied = await requireProjectEditTasksApi(planning.projectId);
  if (denied) return denied;

  // Em planejamento (ainda não concluída) → hard delete. CASCADE cuida das
  // tabelas filhas; actions de meetings ficam com planningCeremonyId=NULL.
  // Concluída/arquivada → archive (preserva audit trail).
  const inProgress =
    planning.phase === "idle" ||
    planning.phase === "reading" ||
    planning.phase === "proposing" ||
    planning.phase === "approving";

  if (inProgress) {
    await deletePlanning(id);
    return NextResponse.json({ mode: "deleted" });
  }

  await archivePlanning(id);
  return NextResponse.json({ mode: "archived" });
}
