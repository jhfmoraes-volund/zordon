import { NextResponse } from "next/server";

import { requireMinAccessLevelApi } from "@/lib/dal";
import { deleteAllocation, updateAllocation } from "@/lib/finance/dal";
import type { AllocationInput } from "@/lib/finance/types";

/** PATCH /api/finance/allocations/[id] — atualiza (valida Σ%≤100). Admin-only. */
export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const denied = await requireMinAccessLevelApi("admin");
  if (denied) return denied;
  const { id } = await params;
  let body: AllocationInput;
  try {
    body = (await req.json()) as AllocationInput;
  } catch {
    return NextResponse.json({ error: "Body inválido" }, { status: 400 });
  }
  try {
    const { allocation, warning } = await updateAllocation(id, body);
    return NextResponse.json({ allocation, warning });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}

/** DELETE /api/finance/allocations/[id]. Admin-only. */
export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const denied = await requireMinAccessLevelApi("admin");
  if (denied) return denied;
  const { id } = await params;
  try {
    await deleteAllocation(id);
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error("[/api/finance/allocations/[id] DELETE]", e);
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
