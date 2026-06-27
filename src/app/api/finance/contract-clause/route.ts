import { NextResponse } from "next/server";

import { requireCapabilityApi } from "@/lib/access/require-capability";
import { createClause, listClauses } from "@/lib/finance/dal";
import type { ContractClauseInput } from "@/lib/finance/types";

/** GET /api/finance/contract-clause?contractId= — cláusulas do contrato. Admin-only. */
export async function GET(req: Request) {
  const denied = await requireCapabilityApi("finance.access");
  if (denied) return denied;
  const contractId = new URL(req.url).searchParams.get("contractId");
  if (!contractId) return NextResponse.json({ error: "contractId obrigatório" }, { status: 400 });
  try {
    return NextResponse.json({ clauses: await listClauses(contractId) });
  } catch (e) {
    console.error("[/api/finance/contract-clause GET]", e);
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}

/** POST /api/finance/contract-clause — cria uma cláusula. Admin-only. */
export async function POST(req: Request) {
  const denied = await requireCapabilityApi("finance.access");
  if (denied) return denied;
  let body: ContractClauseInput;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Body inválido" }, { status: 400 });
  }
  try {
    return NextResponse.json({ clause: await createClause(body) });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}
