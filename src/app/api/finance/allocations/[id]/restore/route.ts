import { NextResponse } from "next/server";

import { requireMinAccessLevelApi } from "@/lib/dal";
import { restoreAllocation } from "@/lib/finance/dal";

/**
 * POST /api/finance/allocations/[id]/restore — restaura alocação marcada como erro (D5, MAH-004).
 * Limpa voided_at, voided_reason, voided_by; alocação reaparece nas views de billing/roster.
 * Admin-only.
 */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const denied = await requireMinAccessLevelApi("admin");
  if (denied) return denied;
  const { id } = await params;
  try {
    const allocation = await restoreAllocation(id);
    return NextResponse.json({ allocation });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}
