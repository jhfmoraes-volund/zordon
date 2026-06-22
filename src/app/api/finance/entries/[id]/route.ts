import { NextResponse } from "next/server";

import { requireMinAccessLevelApi } from "@/lib/dal";
import { deleteEntry, updateEntry } from "@/lib/finance/dal";
import type { EntryInput } from "@/lib/finance/types";

/** PATCH /api/finance/entries/[id] — atualiza transação. Admin-only. */
export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const denied = await requireMinAccessLevelApi("admin");
  if (denied) return denied;
  const { id } = await params;
  let body: EntryInput;
  try {
    body = (await req.json()) as EntryInput;
  } catch {
    return NextResponse.json({ error: "Body inválido" }, { status: 400 });
  }
  try {
    return NextResponse.json({ entry: await updateEntry(id, body) });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}

/** DELETE /api/finance/entries/[id] — remove transação. Admin-only. */
export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const denied = await requireMinAccessLevelApi("admin");
  if (denied) return denied;
  const { id } = await params;
  try {
    await deleteEntry(id);
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error("[/api/finance/entries/[id] DELETE]", e);
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
