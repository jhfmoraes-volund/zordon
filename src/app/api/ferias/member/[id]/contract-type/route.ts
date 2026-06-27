import { NextResponse } from "next/server";

import { requireMinAccessLevelApi } from "@/lib/dal";
import { setContractType } from "@/lib/ferias/dal";
import type { ContractType } from "@/lib/ferias/types";

/**
 * PATCH /api/ferias/member/[id]/contract-type — admin define o regime PJ/CLT
 * (governa o allowance de férias). Body: { contractType: 'pj'|'clt'|null }.
 */
export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const denied = await requireMinAccessLevelApi("admin");
  if (denied) return denied;
  const { id } = await params;

  let body: { contractType: ContractType | null };
  try {
    body = (await req.json()) as { contractType: ContractType | null };
  } catch {
    return NextResponse.json({ error: "Body inválido" }, { status: 400 });
  }
  const ct = body.contractType;
  if (ct !== null && ct !== "pj" && ct !== "clt") {
    return NextResponse.json({ error: "contractType deve ser 'pj', 'clt' ou null" }, { status: 400 });
  }

  try {
    await setContractType(id, ct);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}
