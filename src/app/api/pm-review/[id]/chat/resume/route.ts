/**
 * GET /api/pm-review/[id]/chat/resume
 *
 * Reconecta o cliente a um ChatTurn em vôo (PM Review / Vitoria). Chamado por
 * useChat().resumeStream() quando o GET de histórico reporta um activeTurn. O
 * turn é resolvido server-side (último do thread). 204 quando não há nada.
 */
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireProjectViewApi } from "@/lib/dal";
import { getLatestChatTurnForThread } from "@/lib/dal/chat-turn";
import { streamResumeChatTurn } from "@/lib/agent/resume-chat-stream";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: pmReviewId } = await params;

  const { data: pm } = await db()
    .from("PMReview")
    .select("projectId")
    .eq("id", pmReviewId)
    .maybeSingle();
  if (!pm)
    return NextResponse.json({ error: "PM Review não encontrado" }, { status: 404 });

  const denied = await requireProjectViewApi(pm.projectId);
  if (denied) return denied;

  const { data: thread } = await db()
    .from("ChatThread")
    .select("id")
    .eq("agentName", pmReviewId)
    .eq("channel", "pm_review")
    .order("createdAt", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!thread) return new NextResponse(null, { status: 204 });

  const turn = await getLatestChatTurnForThread(thread.id);
  if (!turn) return new NextResponse(null, { status: 204 });

  return streamResumeChatTurn(turn.id);
}
