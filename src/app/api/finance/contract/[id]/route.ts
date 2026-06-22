import { NextResponse } from "next/server";

import { requireMinAccessLevelApi } from "@/lib/dal";
import { deleteContract, updateContract } from "@/lib/finance/dal";
import type { ContractInput } from "@/lib/finance/types";

/** PATCH /api/finance/contract/[id] — edita um contrato. Admin-only. */
export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const denied = await requireMinAccessLevelApi("admin");
  if (denied) return denied;
  const { id } = await params;
  let input: ContractInput;
  try {
    input = await req.json();
  } catch {
    return NextResponse.json({ error: "Body inválido" }, { status: 400 });
  }
  try {
    return NextResponse.json({ contract: await updateContract(id, input) });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}

/** DELETE /api/finance/contract/[id]. Admin-only. */
export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const denied = await requireMinAccessLevelApi("admin");
  if (denied) return denied;
  const { id } = await params;
  try {
    await deleteContract(id);
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error("[/api/finance/contract/[id] DELETE]", e);
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
