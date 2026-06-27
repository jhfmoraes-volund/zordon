import { NextResponse } from "next/server";

import { requireCapabilityApi } from "@/lib/access/require-capability";
import { updateVaga, deleteVaga, deleteVagaHard } from "@/lib/finance/dal";

/** PATCH /api/finance/contract/[id]/vagas/[vagaId] — edita vaga (label/%/fechar). Admin-only. */
export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string; vagaId: string }> },
) {
  const denied = await requireCapabilityApi("finance.access");
  if (denied) return denied;
  const { vagaId } = await params;
  let body: {
    label?: string | null;
    expectedPercent?: number | null;
    effectiveFrom?: string;
    effectiveTo?: string | null;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Body inválido" }, { status: 400 });
  }
  try {
    return NextResponse.json({ vaga: await updateVaga(vagaId, body) });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}

/**
 * DELETE /api/finance/contract/[id]/vagas/[vagaId] — remove a vaga.
 *  · default (slot vazio): soft — só apaga a vaga, ocupações sobreviveriam.
 *  · ?hard=1 (erro/duplicata): apaga a vaga E suas ocupações (sem log). Admin-only.
 */
export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string; vagaId: string }> },
) {
  const denied = await requireCapabilityApi("finance.admin");
  if (denied) return denied;
  const { vagaId } = await params;
  const hard = new URL(req.url).searchParams.get("hard") === "1";
  try {
    if (hard) await deleteVagaHard(vagaId);
    else await deleteVaga(vagaId);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}
