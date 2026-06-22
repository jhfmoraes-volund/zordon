import { NextResponse } from "next/server";

import { requireMinAccessLevelApi } from "@/lib/dal";
import { listContractOverrides, upsertContractOverride } from "@/lib/finance/dal";
import type { ContractMonthOverrideInput } from "@/lib/finance/types";

/** GET /api/finance/contract-override?contractId= — overrides de mês do contrato. Admin-only. */
export async function GET(req: Request) {
  const denied = await requireMinAccessLevelApi("admin");
  if (denied) return denied;
  const contractId = new URL(req.url).searchParams.get("contractId");
  if (!contractId) return NextResponse.json({ error: "contractId obrigatório" }, { status: 400 });
  try {
    return NextResponse.json({ overrides: await listContractOverrides(contractId) });
  } catch (e) {
    console.error("[/api/finance/contract-override GET]", e);
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}

/** POST /api/finance/contract-override — upsert por (contrato, mês). Admin-only. */
export async function POST(req: Request) {
  const denied = await requireMinAccessLevelApi("admin");
  if (denied) return denied;
  let body: { contractId: string } & ContractMonthOverrideInput;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Body inválido" }, { status: 400 });
  }
  const { contractId, ...input } = body;
  if (!contractId) return NextResponse.json({ error: "contractId obrigatório" }, { status: 400 });
  try {
    return NextResponse.json({ override: await upsertContractOverride(contractId, input) });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}
