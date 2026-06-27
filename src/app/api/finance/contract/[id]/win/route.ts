import { NextResponse } from "next/server";

import { requireCapabilityApi } from "@/lib/access/require-capability";
import { winContract } from "@/lib/finance/dal";

/**
 * POST /api/finance/contract/[id]/win — "ganhar proposta". Admin-only.
 * proposed→active + bump de fase commercial→immersion (D1/F1.7).
 */
export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const denied = await requireCapabilityApi("finance.access");
  if (denied) return denied;
  const { id } = await params;
  try {
    return NextResponse.json({ contract: await winContract(id) });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}
