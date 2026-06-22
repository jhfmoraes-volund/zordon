import { NextResponse } from "next/server";

import { requireMinAccessLevelApi } from "@/lib/dal";
import { createContract, listContracts } from "@/lib/finance/dal";
import type { ContractInput } from "@/lib/finance/types";

/** GET /api/finance/contract?projectId= — contratos do projeto (por vigência). Admin-only. */
export async function GET(req: Request) {
  const denied = await requireMinAccessLevelApi("admin");
  if (denied) return denied;
  const projectId = new URL(req.url).searchParams.get("projectId");
  if (!projectId) return NextResponse.json({ error: "projectId obrigatório" }, { status: 400 });
  try {
    return NextResponse.json({ contracts: await listContracts(projectId) });
  } catch (e) {
    console.error("[/api/finance/contract GET]", e);
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}

/** POST /api/finance/contract — cria um contrato (vigência) no projeto. Admin-only. */
export async function POST(req: Request) {
  const denied = await requireMinAccessLevelApi("admin");
  if (denied) return denied;
  let body: { projectId: string } & ContractInput;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Body inválido" }, { status: 400 });
  }
  const { projectId, ...input } = body;
  if (!projectId) return NextResponse.json({ error: "projectId obrigatório" }, { status: 400 });
  try {
    return NextResponse.json({ contract: await createContract(projectId, input) });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}
