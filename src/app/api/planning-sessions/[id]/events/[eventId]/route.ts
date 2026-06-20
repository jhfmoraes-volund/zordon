/**
 * GET /api/planning-sessions/[id]/events/[eventId]
 *
 * Planning Vivo Versionado — snapshot COMPLETO de uma versão (canvas histórico):
 * o evento + PFV por sprint + a lista de tasks daquele "Aplicar". Lazy-load — só
 * é buscado quando o usuário seleciona um log no cronograma.
 *
 * Auth: caller precisa ter acesso ao projeto da sessão (requireProjectViewApi).
 * Valida que o evento pertence à sessão da rota (defense-in-depth: db() bypassa RLS).
 */
import { NextRequest, NextResponse } from "next/server";
import { requireProjectViewApi } from "@/lib/dal";
import { getSession } from "@/lib/dal/planning-session";
import { getPlanningEventSnapshot } from "@/lib/dal/planning-event";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; eventId: string }> },
) {
  const { id: sessionId, eventId } = await params;

  const session = await getSession(sessionId);
  if (!session) {
    return NextResponse.json({ error: "session not found" }, { status: 404 });
  }

  const denied = await requireProjectViewApi(session.projectId);
  if (denied) return denied;

  const event = await getPlanningEventSnapshot(eventId);
  if (!event || event.planningSessionId !== sessionId) {
    return NextResponse.json({ error: "event not found" }, { status: 404 });
  }

  return NextResponse.json({ event });
}
