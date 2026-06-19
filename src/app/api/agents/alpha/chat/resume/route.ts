/**
 * GET /api/agents/alpha/chat/resume?threadId=<id>
 *
 * Reconecta o cliente a um ChatTurn em vôo (Alpha). Chamado por
 * useChat().resumeStream() quando o GET de histórico reporta um activeTurn.
 *
 * Alpha tem múltiplos threads por membro (privados), então o threadId vem do
 * cliente e é validado por ownership. O turn é resolvido server-side (último do
 * thread). 204 quando não há nada — reconnectToStream trata como no-op.
 */
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getCurrentMember, requireMinLevelApi } from "@/lib/dal";
import { MANAGER } from "@/lib/roles";
import { getLatestChatTurnForThread } from "@/lib/dal/chat-turn";
import { streamResumeChatTurn } from "@/lib/agent/resume-chat-stream";

export const maxDuration = 300;

export async function GET(req: NextRequest) {
  const denied = await requireMinLevelApi(MANAGER);
  if (denied) return denied;

  const member = await getCurrentMember();
  if (!member) {
    return NextResponse.json({ error: "Member not found" }, { status: 403 });
  }

  const threadId = req.nextUrl.searchParams.get("threadId");
  if (!threadId) return new NextResponse(null, { status: 204 });

  // Ownership: thread do Alpha pertencente ao membro.
  const { data: owned } = await db()
    .from("ChatThread")
    .select("id")
    .eq("id", threadId)
    .eq("agentName", "alpha")
    .eq("createdBy", member.id)
    .maybeSingle();
  if (!owned) return new NextResponse(null, { status: 204 });

  const turn = await getLatestChatTurnForThread(threadId);
  if (!turn) return new NextResponse(null, { status: 204 });

  return streamResumeChatTurn(turn.id);
}
