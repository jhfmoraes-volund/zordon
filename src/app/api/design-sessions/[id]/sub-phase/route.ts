import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireSessionAccessApi } from "@/lib/dal";
import { db } from "@/lib/db";
import { BRIEFING_SUB_PHASE_VALUES } from "@/lib/design-sessions/constants";

/**
 * POST /api/design-sessions/[id]/sub-phase
 *
 * Persists briefing sub-phase + target story id em colunas escalares de
 * `DesignSession` (briefingSubPhase, briefingTargetStoryId). Vitor's
 * loadContext lê essas colunas e o prompt roteia para o modo correto.
 * Vocabulário válido vive em @/lib/design-sessions/constants.
 *
 * Chamado pelos botões de tree action ANTES do envio de mensagem:
 *   await fetch('/sub-phase', { body: { subPhase, targetStoryId } })
 *   sendMessage({ text: "..." })
 *
 * A ordem importa — quando o request do chat chega, a coluna já está
 * persistida e o loadContext lê o valor novo.
 */

const SubPhaseSchema = z.object({
  subPhase: z.enum(BRIEFING_SUB_PHASE_VALUES as unknown as [string, ...string[]]),
  targetStoryId: z.string().uuid().nullable().optional(),
});

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: sessionId } = await params;
  const denied = await requireSessionAccessApi(sessionId);
  if (denied) return denied;

  const body = await req.json().catch(() => ({}));
  const parsed = SubPhaseSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "invalid body", details: parsed.error.flatten() },
      { status: 400 },
    );
  }
  const { subPhase, targetStoryId } = parsed.data;

  const { error } = await db()
    .from("DesignSession")
    .update({
      briefingSubPhase: subPhase,
      briefingTargetStoryId: targetStoryId ?? null,
    })
    .eq("id", sessionId);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ subPhase, targetStoryId: targetStoryId ?? null });
}
