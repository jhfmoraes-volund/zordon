import { NextRequest, NextResponse } from "next/server";
import { requireSessionEditApi, getCurrentMember } from "@/lib/dal";
import { reopenSession } from "@/lib/dal/story-hierarchy";

/**
 * POST /api/design-sessions/[id]/reopen
 *
 * Reverte uma Design Session concluída em cascata atômica:
 *   - Pre-flight: bloqueia se qualquer task da sessão saiu do backlog
 *     (todo/in_progress/review/done)
 *   - Module.approvedAt = NULL (todos os módulos da sessão)
 *   - UserStory.refinementStatus → 'draft' (todas)
 *   - Task.status backlog → 'draft' (em massa)
 *   - DesignSession.status = 'in_progress', completedAt = NULL
 *   - ModuleActivity 'session_reopened' por módulo
 *
 * Stories desaparecem da lista do projeto até a sessão ser concluída de novo.
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
    const result = await reopenSession(sessionId, member?.id ?? null);
    if (!result.ok) {
      return NextResponse.json(
        {
          error: "blocked",
          message: `${result.blocking.length} task(s) já saíram do backlog`,
          blocking: result.blocking,
        },
        { status: 409 },
      );
    }
    return NextResponse.json(result);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "reopen failed";
    const status = /Apenas sessões concluídas/i.test(msg) ? 409 : 500;
    return NextResponse.json({ error: msg }, { status });
  }
}
