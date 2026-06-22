import { NextResponse } from "next/server";

import { requireMinAccessLevelApi } from "@/lib/dal";
import { createAllocation, listAllocations } from "@/lib/finance/dal";
import type { AllocationInput } from "@/lib/finance/types";

/** GET /api/finance/allocations?projectId=&memberId= — alocações. Admin-only. */
export async function GET(req: Request) {
  const denied = await requireMinAccessLevelApi("admin");
  if (denied) return denied;
  const { searchParams } = new URL(req.url);
  try {
    const allocations = await listAllocations({
      projectId: searchParams.get("projectId") || undefined,
      memberId: searchParams.get("memberId") || undefined,
    });
    return NextResponse.json({ allocations });
  } catch (e) {
    console.error("[/api/finance/allocations GET]", e);
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}

/** POST /api/finance/allocations — cria alocação (valida Σ%≤100). Admin-only. */
export async function POST(req: Request) {
  const denied = await requireMinAccessLevelApi("admin");
  if (denied) return denied;
  let body: AllocationInput;
  try {
    body = (await req.json()) as AllocationInput;
  } catch {
    return NextResponse.json({ error: "Body inválido" }, { status: 400 });
  }
  try {
    return NextResponse.json({ allocation: await createAllocation(body) }, { status: 201 });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}
