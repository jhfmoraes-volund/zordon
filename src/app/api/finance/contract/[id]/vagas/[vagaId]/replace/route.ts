import { NextResponse } from "next/server";

import { requireCapabilityApi } from "@/lib/access/require-capability";
import { replaceVagaOccupant } from "@/lib/finance/dal";

/**
 * POST /api/finance/contract/[id]/vagas/[vagaId]/replace — troca o ocupante.
 * Fecha a ocupação atual (effectiveTo) e cria a nova na mesma vaga. Admin-only.
 * Body: { currentAllocationId, effectiveTo, newMemberId, newPercent?, newEffectiveFrom, note? }
 */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string; vagaId: string }> },
) {
  const denied = await requireCapabilityApi("finance.access");
  if (denied) return denied;
  const { vagaId } = await params;
  let body: {
    currentAllocationId?: string;
    effectiveTo?: string;
    newMemberId?: string;
    newPercent?: number | null;
    newEffectiveFrom?: string;
    note?: string | null;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Body inválido" }, { status: 400 });
  }
  if (
    !body.currentAllocationId ||
    !body.effectiveTo ||
    !body.newMemberId ||
    !body.newEffectiveFrom
  ) {
    return NextResponse.json(
      {
        error:
          "currentAllocationId, effectiveTo, newMemberId e newEffectiveFrom são obrigatórios",
      },
      { status: 400 },
    );
  }
  try {
    const result = await replaceVagaOccupant({
      vagaId,
      currentAllocationId: body.currentAllocationId,
      effectiveTo: body.effectiveTo,
      newMemberId: body.newMemberId,
      newPercent: body.newPercent ?? null,
      newEffectiveFrom: body.newEffectiveFrom,
      note: body.note ?? null,
    });
    return NextResponse.json(result);
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}
