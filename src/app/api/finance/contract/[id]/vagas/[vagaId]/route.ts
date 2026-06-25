import { NextResponse } from "next/server";

import { requireMinAccessLevelApi } from "@/lib/dal";
import { updateVaga, deleteVaga } from "@/lib/finance/dal";

/** PATCH /api/finance/contract/[id]/vagas/[vagaId] — edita vaga (label/%/fechar). Admin-only. */
export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string; vagaId: string }> },
) {
  const denied = await requireMinAccessLevelApi("admin");
  if (denied) return denied;
  const { vagaId } = await params;
  let body: { label?: string | null; expectedPercent?: number | null; effectiveTo?: string | null };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Body inválido" }, { status: 400 });
  }
  try {
    return NextResponse.json({ vaga: await updateVaga(vagaId, body) });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}

/** DELETE /api/finance/contract/[id]/vagas/[vagaId] — remove vaga (ocupações sobrevivem). Admin-only. */
export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string; vagaId: string }> },
) {
  const denied = await requireMinAccessLevelApi("admin");
  if (denied) return denied;
  const { vagaId } = await params;
  try {
    await deleteVaga(vagaId);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}
