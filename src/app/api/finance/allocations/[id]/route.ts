import { NextResponse } from "next/server";

import { requireMinAccessLevelApi } from "@/lib/dal";
import { updateAllocation } from "@/lib/finance/dal";

/**
 * PATCH /api/finance/allocations/[id] — edita campos da alocação.
 * Standing (D2): só note, effectiveTo (fechar). Mudar período/valor: close + create.
 * Spot: também aceita `days` (horas) e `effectiveFrom` — correção pontual direta.
 * DELETE removido (D4: remoção = void, implementado em MAH-004).
 * Admin-only.
 */
export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const denied = await requireMinAccessLevelApi("admin");
  if (denied) return denied;
  const { id } = await params;
  let body: {
    note?: string | null;
    effectiveTo?: string | null;
    days?: number | null;
    effectiveFrom?: string;
  };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Body inválido" }, { status: 400 });
  }
  try {
    const allocation = await updateAllocation(id, body);
    return NextResponse.json({ allocation });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}
