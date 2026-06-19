/**
 * GET /api/planning/[id]/chat/resume
 *
 * Reconecta o cliente a um ChatTurn em vôo (Sprint Planning / Vitoria). Chamado
 * por useChat().resumeStream() quando o GET de histórico reporta um activeTurn. O
 * turn é resolvido server-side (último do thread). 204 quando não há nada.
 */
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireProjectViewApi } from "@/lib/dal";
import { getPlanningById } from "@/lib/dal/planning";
import { getLatestChatTurnForThread } from "@/lib/dal/chat-turn";
import { streamResumeChatTurn } from "@/lib/agent/resume-chat-stream";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: planningId } = await params;

  const planning = await getPlanningById(planningId);
  if (!planning) {
    return NextResponse.json({ error: "Planning não encontrada" }, { status: 404 });
  }
  const denied = await requireProjectViewApi(planning.projectId);
  if (denied) return denied;

  const { data: thread } = await db()
    .from("ChatThread")
    .select("id")
    .eq("agentName", planningId)
    .eq("channel", "planning")
    .order("createdAt", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!thread) return new NextResponse(null, { status: 204 });

  const turn = await getLatestChatTurnForThread(thread.id);
  if (!turn) return new NextResponse(null, { status: 204 });

  return streamResumeChatTurn(turn.id);
}
