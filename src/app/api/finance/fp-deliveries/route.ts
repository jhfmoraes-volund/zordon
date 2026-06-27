import { NextResponse } from "next/server";

import { requireCapabilityApi } from "@/lib/access/require-capability";
import { createFpDelivery, listFpDeliveries } from "@/lib/finance/dal";
import type { FpDeliveryInput } from "@/lib/finance/types";

/** GET /api/finance/fp-deliveries?projectId= — entregas de FP. Admin-only. */
export async function GET(req: Request) {
  const denied = await requireCapabilityApi("finance.access");
  if (denied) return denied;
  const projectId = new URL(req.url).searchParams.get("projectId");
  if (!projectId) return NextResponse.json({ error: "projectId obrigatório" }, { status: 400 });
  try {
    return NextResponse.json({ deliveries: await listFpDeliveries(projectId) });
  } catch (e) {
    console.error("[/api/finance/fp-deliveries GET]", e);
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}

/** POST /api/finance/fp-deliveries — registra entrega de FP. Admin-only. */
export async function POST(req: Request) {
  const denied = await requireCapabilityApi("finance.access");
  if (denied) return denied;
  let body: { projectId: string } & FpDeliveryInput;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Body inválido" }, { status: 400 });
  }
  const { projectId, ...input } = body;
  if (!projectId) return NextResponse.json({ error: "projectId obrigatório" }, { status: 400 });
  try {
    await createFpDelivery(projectId, input);
    return NextResponse.json({ ok: true }, { status: 201 });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}
