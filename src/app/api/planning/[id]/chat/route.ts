/**
 * POST /api/planning/[id]/chat
 * Chat com Vitória — Copiloto de Rituais.
 */
import { NextRequest } from "next/server";
import { planningChatConnector } from "@/lib/agent/connectors/planning-chat";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  return planningChatConnector.handle(req, id);
}
