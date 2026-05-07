import { NextRequest, NextResponse } from "next/server";
import { requireSessionEditApi, getCurrentMember } from "@/lib/dal";
import { completeSession } from "@/lib/dal/story-hierarchy";

/**
 * POST /api/design-sessions/[id]/complete
 *
 * Aprovação atômica da Design Session inteira (modelo "tudo ou nada"):
 *   - Module.approvedAt = now (todos os módulos da sessão)
 *   - UserStory.refinementStatus → 'committed' (todas)
 *   - Task.status → 'backlog' (todas as 'draft' da sessão)
 *   - DesignSession.status = 'completed', completedAt = now
 *   - ModuleActivity 'session_completed' por módulo
 *
 * Stories só ficam visíveis no projeto a partir desse ponto. Aprovação
 * granular (approve_module) foi descontinuada na DS — PM concentra no
 * fechamento da sessão.
 */
export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: sessionId } = await params;
  const denied = await requireSessionEditApi(sessionId);
  if (denied) return denied;

  const member = await getCurrentMember();

  try {
    const result = await completeSession(sessionId, member?.id ?? null);
    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "complete failed";
    const status = /já está concluída/i.test(msg) ? 409 : 500;
    return NextResponse.json({ error: msg }, { status });
  }
}
