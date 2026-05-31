import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireSessionEditApi } from "@/lib/dal";

/**
 * DELETE /api/design-sessions/[id]/transcripts/[transcriptId]
 *
 * Remove o link da transcrição com a sessão. `transcriptId` no URL é o
 * `DesignSessionTranscriptLink.id` (forma estável que o GET expôs como
 * `imported[].id`).
 *
 * Não apaga o `TranscriptRef` em si — outras DSs ou Plannings podem estar
 * usando a mesma transcrição. Quem deve remover a SSOT é um job separado
 * (futuro: garbage collect TranscriptRefs sem links).
 *
 * Defesa em profundidade: WHERE pinia tanto o id do link quanto o sessionId
 * pra que URL com link de outra sessão não delete por engano.
 */
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; transcriptId: string }> },
) {
  const { id: sessionId, transcriptId: linkId } = await params;

  const denied = await requireSessionEditApi(sessionId);
  if (denied) return denied;

  const { error } = await db()
    .from("EntityLink")
    .delete()
    .eq("id", linkId)
    .eq("designSessionId", sessionId);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
