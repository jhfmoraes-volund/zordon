/**
 * Link/unlink de TranscriptRef numa PlanningCeremony — curadoria manual do PM.
 *
 * POST   body  { transcriptRefId, weight?, note? }   → link
 * DELETE query ?transcriptRefId=…                    → unlink
 *
 * `weight` ∈ primary | supporting | background — guia o Alpha na síntese.
 */
import { NextRequest, NextResponse } from "next/server";
import { getActorMemberId, requireProjectViewApi } from "@/lib/dal";
import {
  getPlanningById,
  linkTranscriptToPlanning,
  unlinkTranscriptFromPlanning,
  type TranscriptWeight,
} from "@/lib/dal/planning";

const VALID_WEIGHTS: readonly TranscriptWeight[] = [
  "primary",
  "supporting",
  "background",
];

async function loadAndAuthorize(id: string) {
  const planning = await getPlanningById(id);
  if (!planning) {
    return {
      denied: NextResponse.json({ error: "Planning não encontrada" }, { status: 404 }),
    };
  }
  const denied = await requireProjectViewApi(planning.projectId);
  if (denied) return { denied };
  return { planning };
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const { denied } = await loadAndAuthorize(id);
  if (denied) return denied;

  const body = (await req.json().catch(() => null)) as
    | { transcriptRefId?: string; weight?: string; note?: string | null }
    | null;
  if (!body?.transcriptRefId) {
    return NextResponse.json({ error: "transcriptRefId obrigatório" }, { status: 400 });
  }
  const weight = body.weight as TranscriptWeight | undefined;
  if (weight && !VALID_WEIGHTS.includes(weight)) {
    return NextResponse.json(
      { error: `weight inválido. válidos: ${VALID_WEIGHTS.join(", ")}` },
      { status: 400 },
    );
  }

  const linkedById = await getActorMemberId();
  if (!linkedById) {
    return NextResponse.json({ error: "sem memberId no contexto" }, { status: 401 });
  }

  try {
    const link = await linkTranscriptToPlanning({
      planningCeremonyId: id,
      transcriptRefId: body.transcriptRefId,
      linkedById,
      weight,
      note: body.note ?? null,
    });
    return NextResponse.json(link, { status: 201 });
  } catch (err) {
    const msg = String(err);
    if (msg.includes("duplicate key") || msg.includes("23505")) {
      return NextResponse.json({ error: "transcript já linkado" }, { status: 409 });
    }
    return NextResponse.json(
      { error: "Falha ao linkar transcript", detail: msg },
      { status: 500 },
    );
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const { denied } = await loadAndAuthorize(id);
  if (denied) return denied;

  const transcriptRefId = req.nextUrl.searchParams.get("transcriptRefId");
  if (!transcriptRefId) {
    return NextResponse.json({ error: "transcriptRefId obrigatório" }, { status: 400 });
  }

  await unlinkTranscriptFromPlanning(id, transcriptRefId);
  return NextResponse.json({ ok: true });
}
