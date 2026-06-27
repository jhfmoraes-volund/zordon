import { NextResponse } from "next/server";
import { getCurrentMember } from "@/lib/dal";
import { requireCapabilityApi } from "@/lib/access/require-capability";
import {
  createForgeRunFromSession,
  getProjectForgeSummary,
} from "@/lib/dal/forge-project";

export const dynamic = "force-dynamic";

/**
 * POST /api/forge/projects/[id]/runs
 *
 * Dispara um run novo: snapshota PRDs aprovados da source session pra dentro
 * de ForgeRun.manifest e enfileira um ForgeJob (status=queued). O daemon
 * local claim o job e executa lendo o manifest do banco.
 *
 * Body opcional:
 *   { retryFailed: true }  → snapshot só inclui PRDs que falharam no último run
 *
 * Pré-condições (validadas no DAL):
 * - Project.forgeSourceSessionId setado
 * - Session tem ≥ 1 PRD aprovado
 */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: projectId } = await params;

  const denied = await requireCapabilityApi("forge.operate");
  if (denied) return denied;

  const member = await getCurrentMember();
  if (!member) {
    return NextResponse.json({ error: "member_not_found" }, { status: 403 });
  }

  let body: { retryFailed?: boolean; prdRefs?: string[] } = {};
  try {
    body = await req.json();
  } catch {
    // body opcional
  }

  let prdRefsFilter: string[] | undefined;
  if (body.retryFailed) {
    const summary = await getProjectForgeSummary(projectId);
    if (summary.lastFinishedRunFailedPrdRefs.length === 0) {
      return NextResponse.json(
        { error: "no_failed_prds_to_retry" },
        { status: 400 },
      );
    }
    prdRefsFilter = summary.lastFinishedRunFailedPrdRefs;
  } else if (body.prdRefs && Array.isArray(body.prdRefs) && body.prdRefs.length > 0) {
    // Disparo direto de N PRDs específicos (botão "Disparar" no painel da PRD).
    prdRefsFilter = body.prdRefs;
  }

  try {
    const result = await createForgeRunFromSession({
      projectId,
      ownerId: member.id,
      prdRefsFilter,
    });
    return NextResponse.json(result, { status: 202 });
  } catch (err) {
    console.error("[POST /api/forge/projects/.../runs] failed:", err);
    const msg = err instanceof Error ? err.message : "unknown error";
    const stack = err instanceof Error ? err.stack : null;
    return NextResponse.json({ error: msg, stack }, { status: 400 });
  }
}
