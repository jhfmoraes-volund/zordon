import { NextResponse } from "next/server";

import { requireMinAccessLevelApi } from "@/lib/dal";
import { listContractRoster } from "@/lib/finance/dal";

/**
 * GET /api/finance/contract-roster?projectId= — equipe alocada por contrato,
 * legível pelo app Contratos (PM+). Gate manager (PM pra cima); a fronteira por
 * projeto está na view finance.v_contract_roster (can_view_project OR is_admin).
 * SÓ identidade/cargo/%/vigência — valores (custo/salário) nunca trafegam aqui.
 */
export async function GET(req: Request) {
  const denied = await requireMinAccessLevelApi("manager");
  if (denied) return denied;
  const projectId = new URL(req.url).searchParams.get("projectId");
  if (!projectId) return NextResponse.json({ error: "projectId obrigatório" }, { status: 400 });
  try {
    return NextResponse.json({ roster: await listContractRoster(projectId) });
  } catch (e) {
    console.error("[/api/finance/contract-roster GET]", e);
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
