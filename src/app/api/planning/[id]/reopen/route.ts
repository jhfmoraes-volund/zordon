/**
 * POST /api/planning/[id]/reopen
 *
 * Reabre uma planning concluída pra refino ("1 planning viva por sprint").
 * Volta phase closed → proposing e anula closedAt. Re-concluir depois é
 * idempotente (só aplica actions ainda pending — tasks já criadas não duplicam).
 */
import { NextRequest, NextResponse } from "next/server";
import { requireProjectEditTasksApi } from "@/lib/dal";
import { getPlanningById, reopenPlanning } from "@/lib/dal/planning";

export async function POST(
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

  if (planning.phase !== "closed") {
    return NextResponse.json(
      { error: "só planning concluída pode ser reaberta", phase: planning.phase },
      { status: 409 },
    );
  }

  try {
    const reopened = await reopenPlanning(id);
    return NextResponse.json(reopened);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { error: "Falha ao reabrir planning", detail: msg },
      { status: 500 },
    );
  }
}
