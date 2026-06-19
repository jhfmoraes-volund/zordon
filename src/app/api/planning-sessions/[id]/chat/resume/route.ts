/**
 * GET /api/planning-sessions/[id]/chat/resume
 *
 * Reconecta o cliente a um ChatTurn em vôo (Release Planning / Vitoria). Chamado
 * por useChat().resumeStream() quando o GET de histórico reporta um activeTurn.
 * Re-emite o mesmo UIMessage stream do turn fresco a partir do log durável.
 *
 * O turn é resolvido server-side (último do thread access-checado) — o cliente
 * não passa id. 204 quando não há thread/turn — reconnectToStream trata no-op.
 */
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireProjectViewApi } from "@/lib/dal";
import { getSession } from "@/lib/dal/planning-session";
import { getLatestChatTurnForThread } from "@/lib/dal/chat-turn";
import { streamResumeChatTurn } from "@/lib/agent/resume-chat-stream";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: sessionId } = await params;

  const session = await getSession(sessionId);
  if (!session) {
    return NextResponse.json({ error: "session not found" }, { status: 404 });
  }
  const denied = await requireProjectViewApi(session.projectId);
  if (denied) return denied;

  const { data: thread } = await db()
    .from("ChatThread")
    .select("id")
    .eq("agentName", sessionId)
    .eq("channel", "release_planning")
    .order("createdAt", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!thread) return new NextResponse(null, { status: 204 });

  const turn = await getLatestChatTurnForThread(thread.id);
  if (!turn) return new NextResponse(null, { status: 204 });

  return streamResumeChatTurn(turn.id);
}
