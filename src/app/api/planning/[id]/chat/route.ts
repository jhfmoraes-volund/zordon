/**
 * POST /api/planning/[id]/chat
 * Chat com Vitoria — Copiloto de Rituais.
 *
 * Stub: aceita mensagens, retorna 501 até o conector estar pronto.
 * Substituir pelo planningChatConnector quando Vitoria estiver implementada.
 */
import { NextRequest, NextResponse } from "next/server";
import { requireProjectViewApi } from "@/lib/dal";
import { getPlanningById } from "@/lib/dal/planning";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  const planning = await getPlanningById(id);
  if (!planning) {
    return NextResponse.json({ error: "Planning não encontrada" }, { status: 404 });
  }

  const denied = await requireProjectViewApi(planning.projectId);
  if (denied) return denied;

  // TODO: substituir pelo planningChatConnector quando Vitoria estiver pronta
  // import { planningChatConnector } from "@/lib/agent/connectors/planning-chat";
  // return planningChatConnector.handle(req, id);

  return NextResponse.json(
    { error: "Vitoria ainda não está disponível neste ritual." },
    { status: 501 },
  );
}
