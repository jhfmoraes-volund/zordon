/**
 * POST /api/pm-review/[id]/notes — cria nota tipada manualmente (PM).
 * Body: { kind, content, sourceMeetingIds?, sourceTranscriptIds?, priority? }
 *
 * Vitoria também grava notes mas via tool — não passa por esta rota.
 */
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getActorMemberId } from "@/lib/dal";
import { canCreatePMReviewForProject } from "@/lib/pm-review/permission";
import {
  addPMReviewNote,
  PM_REVIEW_NOTE_KINDS,
  type PMReviewNoteKind,
} from "@/lib/dal/pm-review";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  const { data: pm } = await db()
    .from("PMReview")
    .select("projectId")
    .eq("id", id)
    .maybeSingle();
  if (!pm)
    return NextResponse.json({ error: "PM Review não encontrado" }, { status: 404 });

  const allowed = await canCreatePMReviewForProject(pm.projectId);
  if (!allowed)
    return NextResponse.json(
      { error: "Apenas PMs (lead) ou admins podem editar." },
      { status: 403 },
    );

  const body = (await req.json().catch(() => null)) as {
    kind?: string;
    content?: string;
    sourceMeetingIds?: string[];
    sourceTranscriptIds?: string[];
    priority?: number;
  } | null;

  if (!body?.kind || !body.content) {
    return NextResponse.json(
      { error: "kind e content obrigatórios" },
      { status: 400 },
    );
  }
  if (!PM_REVIEW_NOTE_KINDS.includes(body.kind as PMReviewNoteKind)) {
    return NextResponse.json(
      { error: `kind inválido. Use: ${PM_REVIEW_NOTE_KINDS.join(", ")}` },
      { status: 400 },
    );
  }

  const memberId = await getActorMemberId();
  if (!memberId)
    return NextResponse.json({ error: "Member não autenticado" }, { status: 401 });

  try {
    const note = await addPMReviewNote({
      pmReviewId: id,
      kind: body.kind as PMReviewNoteKind,
      content: body.content,
      sourceMeetingIds: body.sourceMeetingIds ?? [],
      sourceTranscriptIds: body.sourceTranscriptIds ?? [],
      priority: body.priority ?? 0,
      generatedByMemberId: memberId,
    });
    return NextResponse.json(note, { status: 201 });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { error: "Falha ao criar nota", detail: msg },
      { status: 500 },
    );
  }
}
