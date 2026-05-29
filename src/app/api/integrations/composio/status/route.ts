import { NextResponse } from "next/server";
import { getCurrentMember } from "@/lib/dal";
import { getConnectionStatus } from "@/lib/composio/client";

/**
 * GET /api/integrations/composio/status?toolkit=github
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
  const toolkit = url.searchParams.get("toolkit");
  if (toolkit !== "github") {
    return NextResponse.json(
      { error: "Toolkit não suportado. Suportados: github" },
      { status: 400 },
    );
  }

  const status = await getConnectionStatus(member.id, toolkit);
  return NextResponse.json(status);
}
