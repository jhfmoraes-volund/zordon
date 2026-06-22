import { NextResponse } from "next/server";

import { requireMinAccessLevelApi } from "@/lib/dal";
import { deleteFpDelivery } from "@/lib/finance/dal";

/** DELETE /api/finance/fp-deliveries/[id]. Admin-only. */
export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const denied = await requireMinAccessLevelApi("admin");
  if (denied) return denied;
  const { id } = await params;
  try {
    await deleteFpDelivery(id);
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error("[/api/finance/fp-deliveries/[id] DELETE]", e);
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
