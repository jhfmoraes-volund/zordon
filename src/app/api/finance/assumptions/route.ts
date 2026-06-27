import { NextResponse } from "next/server";

import { requireCapabilityApi } from "@/lib/access/require-capability";
import {
  deleteAssumptionsOverride,
  getEffectiveAssumptions,
  upsertAssumptions,
} from "@/lib/finance/dal";
import type { AssumptionsInput } from "@/lib/finance/types";

/** GET /api/finance/assumptions?projectId= — premissas vigentes (override→global). */
export async function GET(req: Request) {
  const denied = await requireCapabilityApi("finance.access");
  if (denied) return denied;
  const { searchParams } = new URL(req.url);
  try {
    const { assumptions, isOverride } = await getEffectiveAssumptions(
      searchParams.get("projectId") || undefined,
    );
    return NextResponse.json({ assumptions, isOverride });
  } catch (e) {
    console.error("[/api/finance/assumptions GET]", e);
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}

/** PUT /api/finance/assumptions — upsert global (projectId null) ou override. */
export async function PUT(req: Request) {
  const denied = await requireCapabilityApi("finance.access");
  if (denied) return denied;
  let body: { projectId: string | null } & AssumptionsInput;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Body inválido" }, { status: 400 });
  }
  const { projectId, ...input } = body;
  try {
    return NextResponse.json({ assumptions: await upsertAssumptions(projectId ?? null, input) });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}

/** DELETE /api/finance/assumptions?projectId= — remove override (volta ao global). */
export async function DELETE(req: Request) {
  const denied = await requireCapabilityApi("finance.admin");
  if (denied) return denied;
  const { searchParams } = new URL(req.url);
  const projectId = searchParams.get("projectId");
  if (!projectId) return NextResponse.json({ error: "projectId obrigatório" }, { status: 400 });
  try {
    await deleteAssumptionsOverride(projectId);
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error("[/api/finance/assumptions DELETE]", e);
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
