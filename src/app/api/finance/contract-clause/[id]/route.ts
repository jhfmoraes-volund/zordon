import { NextResponse } from "next/server";

import { requireMinAccessLevelApi } from "@/lib/dal";
import { deleteClause, updateClause } from "@/lib/finance/dal";
import type { ContractClauseInput } from "@/lib/finance/types";

/** PATCH /api/finance/contract-clause/[id]. Admin-only. */
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const denied = await requireMinAccessLevelApi("admin");
  if (denied) return denied;
  const { id } = await params;
  let body: Partial<Pick<ContractClauseInput, "kind" | "text" | "sort">>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Body inválido" }, { status: 400 });
  }
  try {
    return NextResponse.json({ clause: await updateClause(id, body) });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}

/** DELETE /api/finance/contract-clause/[id]. Admin-only. */
export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const denied = await requireMinAccessLevelApi("admin");
  if (denied) return denied;
  const { id } = await params;
  try {
    await deleteClause(id);
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error("[/api/finance/contract-clause/[id] DELETE]", e);
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
