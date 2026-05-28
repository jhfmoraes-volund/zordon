/**
 * PATCH /api/planning/[id]/notes/[noteId]
 * Por ora só uma operação: dismiss (stamp dismissedAt = now()).
 *
 * Body: { dismissed: true }  (formato deixa espaço pra reabrir/editar no futuro)
 */
import { NextRequest, NextResponse } from "next/server";
import { requireProjectViewApi } from "@/lib/dal";
import { dismissContextNote, getPlanningById } from "@/lib/dal/planning";

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; noteId: string }> },
) {
  const { id, noteId } = await params;

  // Carrega a planning pra autorizar via projeto. Pré-busca a note também
  // garante 404 cedo.
  const planning = await getPlanningById(id);
  if (!planning) {
    return NextResponse.json({ error: "Planning não encontrada" }, { status: 404 });
  }
  const denied = await requireProjectViewApi(planning.projectId);
  if (denied) return denied;

  const note = planning.notes.find((n) => n.id === noteId);
  if (!note) {
    return NextResponse.json({ error: "Note não encontrada nesta Planning" }, { status: 404 });
  }

  const body = (await req.json().catch(() => null)) as { dismissed?: boolean } | null;
  if (body?.dismissed !== true) {
    return NextResponse.json(
      { error: "operação inválida (apenas { dismissed: true } suportado)" },
      { status: 400 },
    );
  }

  if (note.dismissedAt) {
    // Idempotente — já dismissed, retorna como está.
    return NextResponse.json(note);
  }

  const updated = await dismissContextNote(noteId);
  return NextResponse.json(updated);
}
