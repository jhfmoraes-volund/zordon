import { NextResponse } from "next/server";

import { requireMinAccessLevelApi } from "@/lib/dal";
import { deleteInvoice, updateInvoice } from "@/lib/finance/dal";
import type { InvoiceInput } from "@/lib/finance/types";

/** PATCH /api/finance/invoice/[id] — atualiza status/datas/valores da NF. Admin-only. */
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const denied = await requireMinAccessLevelApi("admin");
  if (denied) return denied;
  const { id } = await params;
  let body: Partial<InvoiceInput>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Body inválido" }, { status: 400 });
  }
  try {
    return NextResponse.json({ invoice: await updateInvoice(id, body) });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}

/** DELETE /api/finance/invoice/[id]. Admin-only. */
export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const denied = await requireMinAccessLevelApi("admin");
  if (denied) return denied;
  const { id } = await params;
  try {
    await deleteInvoice(id);
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error("[/api/finance/invoice/[id] DELETE]", e);
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
