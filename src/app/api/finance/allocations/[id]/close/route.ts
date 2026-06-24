import { NextResponse } from "next/server";

import { requireMinAccessLevelApi } from "@/lib/dal";
import { closeAllocation } from "@/lib/finance/dal";

/**
 * POST /api/finance/allocations/[id]/close — fecha período de alocação (MAH-004).
 * Body: { effectiveTo: string } — data de fim no formato YYYY-MM-DD
 * Seta effective_to + closed_by.
 * Admin-only.
 */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const denied = await requireMinAccessLevelApi("admin");
  if (denied) return denied;
  const { id } = await params;
  let body: { effectiveTo?: string };
  try {
    body = (await req.json()) as { effectiveTo?: string };
  } catch {
    return NextResponse.json({ error: "Body inválido" }, { status: 400 });
  }
  if (!body.effectiveTo) {
    return NextResponse.json({ error: "effectiveTo é obrigatório" }, { status: 400 });
  }
  try {
    const allocation = await closeAllocation(id, body.effectiveTo);
    return NextResponse.json({ allocation });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}
