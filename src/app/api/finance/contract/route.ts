import { NextResponse } from "next/server";

import { requireMinAccessLevelApi } from "@/lib/dal";
import { getContract, upsertContract } from "@/lib/finance/dal";
import type { ContractInput } from "@/lib/finance/types";

/** GET /api/finance/contract?projectId= — contrato do projeto. Admin-only. */
export async function GET(req: Request) {
  const denied = await requireMinAccessLevelApi("admin");
  if (denied) return denied;
  const projectId = new URL(req.url).searchParams.get("projectId");
  if (!projectId) return NextResponse.json({ error: "projectId obrigatório" }, { status: 400 });
  try {
    return NextResponse.json({ contract: await getContract(projectId) });
  } catch (e) {
    console.error("[/api/finance/contract GET]", e);
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}

/** PUT /api/finance/contract — upsert do contrato do projeto. Admin-only. */
export async function PUT(req: Request) {
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
    return NextResponse.json({ contract: await upsertContract(projectId, input) });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}
