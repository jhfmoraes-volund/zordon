import { NextResponse } from "next/server";

import { requireMinAccessLevelApi } from "@/lib/dal";
import { feriasWriteMessage, feriasWriteStatus } from "@/lib/ferias/api-errors";
import { cancelTimeOff, updateTimeOff } from "@/lib/ferias/dal";
import type { TimeOffInput } from "@/lib/ferias/types";

/** PATCH /api/ferias/time-off/[id] — edita datas/tipo/horas/nota (RLS no squad). */
export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const denied = await requireMinAccessLevelApi("manager");
  if (denied) return denied;
  const { id } = await params;

  let body: Partial<TimeOffInput>;
  try {
    body = (await req.json()) as Partial<TimeOffInput>;
  } catch {
    return NextResponse.json({ error: "Body inválido" }, { status: 400 });
  }

  try {
    return NextResponse.json({ timeOff: await updateTimeOff(id, body) });
  } catch (e) {
    const msg = (e as Error).message;
    const status = feriasWriteStatus(msg);
    return NextResponse.json({ error: feriasWriteMessage(msg, status) }, { status });
  }
}

/** DELETE /api/ferias/time-off/[id] — cancela (soft) o lançamento. */
export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const denied = await requireMinAccessLevelApi("manager");
  if (denied) return denied;
  const { id } = await params;

  try {
    await cancelTimeOff(id);
    return NextResponse.json({ ok: true });
  } catch (e) {
    const msg = (e as Error).message;
    const status = feriasWriteStatus(msg);
    return NextResponse.json({ error: feriasWriteMessage(msg, status) }, { status });
  }
}
