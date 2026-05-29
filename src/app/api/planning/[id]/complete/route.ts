/**
 * POST /api/planning/[id]/complete
 *
 * Staging-commit: PM clica "Concluir planning" → aplica todas as
 * MeetingTaskAction pendentes em cascata + transiciona phase pra `closed`.
 *
 * Append-only e irreversível. Pra reverter, PM abre uma nova planning na
 * mesma sprint (discutindo com Vitoria os ajustes).
 */
import { NextRequest, NextResponse } from "next/server";
import { requireProjectEditTasksApi, getCurrentMember } from "@/lib/dal";
import { getPlanningById, concludePlanning } from "@/lib/dal/planning";

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

  const me = await getCurrentMember();
  if (!me) {
    return NextResponse.json({ error: "sem memberId no contexto" }, { status: 401 });
  }

  if (planning.phase === "closed" || planning.phase === "archived") {
    return NextResponse.json(
      { error: "planning já concluída", phase: planning.phase },
      { status: 409 },
    );
  }

  try {
    const result = await concludePlanning(id, me.id);
    return NextResponse.json(result);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { error: "Falha ao concluir planning", detail: msg },
      { status: 500 },
    );
  }
}
