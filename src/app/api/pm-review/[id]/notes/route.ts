/**
 * POST /api/pm-review/[id]/notes — cria nota tipada manualmente (PM).
 * Body: { kind, content, sourceMeetingIds?, sourceTranscriptIds?, priority? }
 *
 * Vitoria também grava notes mas via tool — não passa por esta rota.
 */
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getActorMemberId } from "@/lib/dal";
import { requireCapabilityApi } from "@/lib/access/require-capability";
import {
  addPMReviewNote,
  PM_REVIEW_NOTE_KINDS,
  PM_REVIEW_RISK_STANCES,
  type PMReviewNoteKind,
  type PMReviewRiskStance,
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

  const denied = await requireCapabilityApi("pm_review.write", {
    projectId: pm.projectId,
  });
  if (denied) return denied;

  const body = (await req.json().catch(() => null)) as {
    kind?: string;
    content?: string;
    sourceMeetingIds?: string[];
    sourceTranscriptIds?: string[];
    priority?: number;
    stance?: string;
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
  if (
    body.stance !== undefined &&
    !PM_REVIEW_RISK_STANCES.includes(body.stance as PMReviewRiskStance)
  ) {
    return NextResponse.json(
      { error: `stance inválido. Use: ${PM_REVIEW_RISK_STANCES.join(", ")}` },
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
      stance: (body.stance as PMReviewRiskStance | undefined) ?? null,
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
