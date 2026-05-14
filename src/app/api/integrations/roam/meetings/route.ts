import { NextResponse } from "next/server";
import { getCurrentMember, requireMinLevelApi } from "@/lib/dal";
import { MANAGER } from "@/lib/roles";
import { getMemberRoamClient } from "@/lib/member-integrations";

/**
 * GET /api/integrations/roam/meetings
 *
 * Lists the caller's last 30 Roam transcripts — workspace-wide (não escopado
 * a DesignSession). Usado pelo "Importar reunião" no MeetingSheet pra deixar
 * o user escolher uma transcrição que o Alpha vai ingerir numa Meeting nova.
 */
export async function GET() {
  const denied = await requireMinLevelApi(MANAGER);
  if (denied) return denied;

  const member = await getCurrentMember();
  if (!member) {
    return NextResponse.json({ error: "Member not found" }, { status: 403 });
  }

  const client = await getMemberRoamClient(member.id);
  if (!client) {
    return NextResponse.json({ needsAuth: true, available: [] });
  }

  try {
    const available = await client.listTranscriptsInRange({ max: 30 });
    return NextResponse.json({ needsAuth: false, available });
  } catch (err) {
    const msg = (err as Error).message || "";
    return NextResponse.json({
      needsAuth: false,
      available: [],
      error:
        msg.includes("401") || msg.includes("403")
          ? "Token Roam invalido ou expirado — reconecte em /settings/integrations."
          : `Falha ao listar reunioes do Roam: ${msg}`,
    });
  }
}
