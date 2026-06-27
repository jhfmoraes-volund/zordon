/**
 * POST /api/pm-review/[id]/transcripts
 * Linka 1..N TranscriptRef existentes ao PM Review.
 * Body: { items: Array<{ transcriptRefId: string, weight?: 'primary'|'supporting'|'background', note?: string }> }
 */
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getActorMemberId } from "@/lib/dal";
import { requireCapabilityApi } from "@/lib/access/require-capability";
import {
  linkTranscriptToPMReview,
  type TranscriptWeight,
} from "@/lib/dal/pm-review";

type Item = {
  transcriptRefId?: string;
  weight?: TranscriptWeight | null;
  note?: string | null;
};

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

  const body = (await req.json().catch(() => null)) as { items?: Item[] } | null;
  const items = body?.items ?? [];
  if (!Array.isArray(items) || items.length === 0) {
    return NextResponse.json(
      { error: "Body precisa de `items: [{ transcriptRefId, weight?, note? }]`" },
      { status: 400 },
    );
  }

  const linkedById = await getActorMemberId();
  const created: string[] = [];

  for (const it of items) {
    if (!it.transcriptRefId) continue;
    const res = await linkTranscriptToPMReview({
      pmReviewId: id,
      transcriptRefId: it.transcriptRefId,
      linkedById,
      weight: it.weight ?? "primary",
      note: it.note ?? null,
    });
    if (res.created) created.push(it.transcriptRefId);
  }

  return NextResponse.json({ linked: created.length, transcriptRefIds: created });
}
