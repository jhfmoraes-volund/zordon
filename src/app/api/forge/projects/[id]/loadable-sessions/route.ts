import { NextResponse } from "next/server";
import { getEffectiveAccessLevel } from "@/lib/dal";
import { hasMinAccessLevel } from "@/lib/roles";
import { getLoadableSessions } from "@/lib/dal/forge-project";

export const dynamic = "force-dynamic";

/**
 * GET /api/forge/projects/[id]/loadable-sessions
 *
 * Lista DesignSessions tipo `prd_session` do projeto, com count de PRDs/status.
 * Usada pelo dropdown "Selecionar Session" na tab Forge. Main aparece no topo.
 */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: projectId } = await params;

  const accessLevel = await getEffectiveAccessLevel();
  if (!hasMinAccessLevel(accessLevel, "manager")) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const sessions = await getLoadableSessions(projectId);
  return NextResponse.json({ sessions });
}
