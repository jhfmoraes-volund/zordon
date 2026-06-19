/**
 * GET /api/design-sessions/[id]/chat/resume?channel=web
 *
 * Reconecta o cliente a um ChatTurn em vôo (Design Session / Vitor). Chamado por
 * useChat().resumeStream() quando o GET de histórico reporta um activeTurn. O
 * thread é por-canal (web/briefing), então o channel acompanha a resolução; o
 * turn é resolvido server-side (último do thread). 204 quando não há nada.
 */
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireSessionAccessApi } from "@/lib/dal";
import { getLatestChatTurnForThread } from "@/lib/dal/chat-turn";
import { streamResumeChatTurn } from "@/lib/agent/resume-chat-stream";

export const maxDuration = 300;

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: sessionId } = await params;
  const denied = await requireSessionAccessApi(sessionId);
  if (denied) return denied;

  const channel = req.nextUrl.searchParams.get("channel") || "web";

  const { data: thread } = await db()
    .from("ChatThread")
    .select("id")
    .eq("sessionId", sessionId)
    .eq("channel", channel)
    .order("createdAt", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!thread) return new NextResponse(null, { status: 204 });

  const turn = await getLatestChatTurnForThread(thread.id);
  if (!turn) return new NextResponse(null, { status: 204 });

  return streamResumeChatTurn(turn.id);
}
