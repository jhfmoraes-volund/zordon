/**
 * GET /api/planning-sessions/[id]/events
 *
 * Planning Vivo Versionado — Fase 1 (Log). Lista os PlanningEvent de um Release
 * Planning (mais recente primeiro), cada um com o snapshot de FP por sprint e o
 * briefing. Alimenta a timeline do canvas (substitui o "Plano vazio").
 *
 * Keyed pela PlanningSession (estável) — a companion PlanningCeremony é reciclada
 * a cada apply, então a cadeia de versões vive na sessão, não na cerimônia.
 *
 * Auth: caller precisa ter acesso ao projeto da sessão (requireProjectViewApi).
 */
import { NextRequest, NextResponse } from "next/server";
import { requireProjectViewApi } from "@/lib/dal";
import { getSession } from "@/lib/dal/planning-session";
import { listPlanningEventsForSession } from "@/lib/dal/planning-event";

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

  const events = await listPlanningEventsForSession(sessionId);
  return NextResponse.json({ events });
}
