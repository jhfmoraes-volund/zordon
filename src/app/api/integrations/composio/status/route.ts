import { NextResponse } from "next/server";
import { getCurrentMember } from "@/lib/dal";
import { getConnectionStatus, type ComposioToolkit } from "@/lib/composio/client";

const SUPPORTED_TOOLKITS: ComposioToolkit[] = ["github", "googlesheets", "googledrive"];

/**
 * GET /api/integrations/composio/status?toolkit=github|googlesheets|googledrive
 *   Devolve { status, connectedAccountId } pro toolkit pedido. Usado pelo
 *   card de Integrações em /settings (polling pós-redirect do OAuth pra
 *   detectar 'active').
 */
export async function GET(req: Request) {
  const member = await getCurrentMember();
  if (!member) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(req.url);
  const toolkit = url.searchParams.get("toolkit") as ComposioToolkit | null;
  if (!toolkit || !SUPPORTED_TOOLKITS.includes(toolkit)) {
    return NextResponse.json(
      { error: `Toolkit não suportado. Suportados: ${SUPPORTED_TOOLKITS.join(", ")}` },
      { status: 400 },
    );
  }

  const status = await getConnectionStatus(member.id, toolkit);
  return NextResponse.json(status);
}
