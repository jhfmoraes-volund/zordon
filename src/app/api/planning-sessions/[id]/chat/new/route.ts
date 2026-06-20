/**
 * POST /api/planning-sessions/[id]/chat/new
 *
 * Abre um CHAT NOVO (thread fresco) com a Vitoria pra esta Release Planning.
 * Usado ao aplicar uma versão do plano: a conversa anterior vira histórico e a
 * próxima iteração começa limpa, ao lado do board já atualizado ("ao vivo").
 *
 * Como o GET do chat pega o thread mais recente, basta criar um novo — ele vira
 * o ativo automaticamente.
 */
import { NextRequest, NextResponse } from "next/server";
import { requireProjectViewApi, getCurrentMember } from "@/lib/dal";
import { getSession } from "@/lib/dal/planning-session";
import { startNewReleasePlanningThread } from "@/lib/agent/context";

export async function POST(
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

  const member = await getCurrentMember();
  if (!member) return new NextResponse("Unauthorized", { status: 401 });

  const threadId = await startNewReleasePlanningThread(sessionId, member.id);
  return NextResponse.json({ threadId });
}
