import { NextResponse } from "next/server";

import { requireMinAccessLevelApi } from "@/lib/dal";
import { feriasWriteMessage, feriasWriteStatus } from "@/lib/ferias/api-errors";
import { createTimeOff } from "@/lib/ferias/dal";
import type { TimeOffInput } from "@/lib/ferias/types";

/** POST /api/ferias/time-off — cria férias/folga. RLS confina ao squad do PM. */
export async function POST(req: Request) {
  const denied = await requireMinAccessLevelApi("manager");
  if (denied) return denied;

  let body: TimeOffInput;
  try {
    body = (await req.json()) as TimeOffInput;
  } catch {
    return NextResponse.json({ error: "Body inválido" }, { status: 400 });
  }
  if (!body.memberId || !body.type || !body.startDate || !body.endDate) {
    return NextResponse.json({ error: "Campos obrigatórios faltando" }, { status: 400 });
  }

  try {
    return NextResponse.json({ timeOff: await createTimeOff(body) }, { status: 201 });
  } catch (e) {
    const msg = (e as Error).message;
    const status = feriasWriteStatus(msg);
    return NextResponse.json({ error: feriasWriteMessage(msg, status) }, { status });
  }
}
