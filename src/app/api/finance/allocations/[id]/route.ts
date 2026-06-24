import { NextResponse } from "next/server";

import { requireMinAccessLevelApi } from "@/lib/dal";
import { updateAllocation } from "@/lib/finance/dal";

/**
 * PATCH /api/finance/allocations/[id] — edita campos não-temporais (D2).
 * Permite APENAS: note, effectiveTo (fechar). Para mudar período/valor: close + create.
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
  let body: { note?: string | null; effectiveTo?: string | null };
  try {
    body = (await req.json()) as { note?: string | null; effectiveTo?: string | null };
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
