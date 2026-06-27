import { NextResponse } from "next/server";

import { requireMinAccessLevelApi } from "@/lib/dal";
import { feriasWriteMessage, feriasWriteStatus } from "@/lib/ferias/api-errors";
import { createCompTime } from "@/lib/ferias/dal";
import type { CompTimeInput } from "@/lib/ferias/types";

/** POST /api/ferias/comp-time — registra hora extra (credita ×rate no banco). */
export async function POST(req: Request) {
  const denied = await requireMinAccessLevelApi("manager");
  if (denied) return denied;

  let body: CompTimeInput;
  try {
    body = (await req.json()) as CompTimeInput;
  } catch {
    return NextResponse.json({ error: "Body inválido" }, { status: 400 });
  }
  if (!body.memberId || !body.date || !(body.hoursWorked > 0)) {
    return NextResponse.json({ error: "Informe membro, data e horas (> 0)" }, { status: 400 });
  }

  try {
    return NextResponse.json({ compTime: await createCompTime(body) }, { status: 201 });
  } catch (e) {
    const msg = (e as Error).message;
    const status = feriasWriteStatus(msg);
    return NextResponse.json({ error: feriasWriteMessage(msg, status) }, { status });
  }
}
