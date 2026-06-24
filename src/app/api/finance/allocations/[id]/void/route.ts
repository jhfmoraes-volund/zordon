import { NextResponse } from "next/server";

import { requireMinAccessLevelApi } from "@/lib/dal";
import { voidAllocation } from "@/lib/finance/dal";

/**
 * POST /api/finance/allocations/[id]/void — marca alocação como erro (D4, MAH-004).
 * Body: { reason: string }
 * Seta voided_at, voided_reason, voided_by; alocação some das views de billing/roster.
 * Admin-only. Reversível via POST .../restore.
 */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const denied = await requireMinAccessLevelApi("admin");
  if (denied) return denied;
  const { id } = await params;
  let body: { reason?: string };
  try {
    body = (await req.json()) as { reason?: string };
  } catch {
    return NextResponse.json({ error: "Body inválido" }, { status: 400 });
  }
  if (!body.reason?.trim()) {
    return NextResponse.json({ error: "Motivo é obrigatório" }, { status: 400 });
  }
  try {
    const allocation = await voidAllocation(id, body.reason);
    return NextResponse.json({ allocation });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}
