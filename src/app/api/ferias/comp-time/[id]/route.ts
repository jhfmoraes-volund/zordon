import { NextResponse } from "next/server";

import { requireMinAccessLevelApi } from "@/lib/dal";
import { feriasWriteMessage, feriasWriteStatus } from "@/lib/ferias/api-errors";
import { cancelCompTime } from "@/lib/ferias/dal";

/** DELETE /api/ferias/comp-time/[id] — cancela (soft) o crédito de hora extra. */
export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const denied = await requireMinAccessLevelApi("manager");
  if (denied) return denied;
  const { id } = await params;

  try {
    await cancelCompTime(id);
    return NextResponse.json({ ok: true });
  } catch (e) {
    const msg = (e as Error).message;
    const status = feriasWriteStatus(msg);
    return NextResponse.json({ error: feriasWriteMessage(msg, status) }, { status });
  }
}
