/**
 * PATCH  /api/pm-review/[id]/notes/[noteId] — editar / dismiss.
 * DELETE /api/pm-review/[id]/notes/[noteId] — hard delete.
 */
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { canCreatePMReviewForProject } from "@/lib/pm-review/permission";
import {
  updatePMReviewNote,
  deletePMReviewNote,
  PM_REVIEW_NOTE_KINDS,
  type PMReviewNoteKind,
} from "@/lib/dal/pm-review";

async function authorize(pmReviewId: string): Promise<NextResponse | null> {
  const { data: pm } = await db()
    .from("PMReview")
    .select("projectId")
    .eq("id", pmReviewId)
    .maybeSingle();
  if (!pm)
    return NextResponse.json({ error: "PM Review não encontrado" }, { status: 404 });

  const allowed = await canCreatePMReviewForProject(pm.projectId);
  if (!allowed)
    return NextResponse.json(
      { error: "Apenas PMs (lead) ou admins podem editar notas." },
      { status: 403 },
    );
  return null;
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; noteId: string }> },
) {
  const { id, noteId } = await params;
  const denied = await authorize(id);
  if (denied) return denied;

  const body = (await req.json().catch(() => null)) as {
    kind?: string;
    content?: string;
    priority?: number;
    dismiss?: boolean;
    undismiss?: boolean;
  } | null;
  if (!body)
    return NextResponse.json({ error: "Body inválido" }, { status: 400 });

  const patch: Parameters<typeof updatePMReviewNote>[1] = {};
  if (body.kind !== undefined) {
    if (!PM_REVIEW_NOTE_KINDS.includes(body.kind as PMReviewNoteKind)) {
      return NextResponse.json({ error: "kind inválido" }, { status: 400 });
    }
    patch.kind = body.kind as PMReviewNoteKind;
  }
  if (body.content !== undefined) patch.content = body.content;
  if (body.priority !== undefined) patch.priority = body.priority;
  if (body.dismiss === true) patch.dismissedAt = new Date().toISOString();
  if (body.undismiss === true) patch.dismissedAt = null;

  try {
    const updated = await updatePMReviewNote(noteId, patch);
    return NextResponse.json(updated);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { error: "Falha ao atualizar nota", detail: msg },
      { status: 500 },
    );
  }
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; noteId: string }> },
) {
  const { id, noteId } = await params;
  const denied = await authorize(id);
  if (denied) return denied;

  await deletePMReviewNote(noteId);
  return NextResponse.json({ ok: true });
}
