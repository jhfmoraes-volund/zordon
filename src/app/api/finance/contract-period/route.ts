import { NextResponse } from "next/server";

import { requireMinAccessLevelApi } from "@/lib/dal";
import { listContractPeriods } from "@/lib/finance/dal";

/**
 * GET /api/finance/contract-period?projectId= — período dos contratos (Slice 3).
 * Legível por quem VÊ o projeto (não só admin): a fronteira está na view
 * finance.v_contract_period (can_view_project OR is_admin), consultada no
 * contexto do usuário. SÓ período/identidade — valores nunca trafegam aqui.
 * Gate = autenticado ("guest"); a view filtra as linhas por projeto.
 */
export async function GET(req: Request) {
  const denied = await requireMinAccessLevelApi("guest");
  if (denied) return denied;
  const projectId = new URL(req.url).searchParams.get("projectId");
  if (!projectId) return NextResponse.json({ error: "projectId obrigatório" }, { status: 400 });
  try {
    return NextResponse.json({ periods: await listContractPeriods(projectId) });
  } catch (e) {
    console.error("[/api/finance/contract-period GET]", e);
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
