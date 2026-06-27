import { NextResponse } from "next/server";

import { requireCapabilityApi } from "@/lib/access/require-capability";
import { listVagas, createVaga } from "@/lib/finance/dal";
import type { ContractVagaInput } from "@/lib/finance/types";

/** GET /api/finance/contract/[id]/vagas — vagas do contrato (incl. PM como vaga). Admin-only. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const denied = await requireCapabilityApi("finance.access");
  if (denied) return denied;
  const { id } = await params;
  try {
    return NextResponse.json({ vagas: await listVagas(id) });
  } catch (e) {
    console.error("[/api/finance/contract/[id]/vagas GET]", e);
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}

/** POST /api/finance/contract/[id]/vagas — cria vaga (auto seq). Admin-only. */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const denied = await requireCapabilityApi("finance.access");
  if (denied) return denied;
  const { id } = await params;
  let body: ContractVagaInput;
  try {
    body = (await req.json()) as ContractVagaInput;
  } catch {
    return NextResponse.json({ error: "Body inválido" }, { status: 400 });
  }
  if (!body.position || !body.effectiveFrom) {
    return NextResponse.json(
      { error: "position e effectiveFrom são obrigatórios" },
      { status: 400 },
    );
  }
  try {
    return NextResponse.json({ vaga: await createVaga(id, body) }, { status: 201 });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}
