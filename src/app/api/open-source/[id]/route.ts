import { NextRequest, NextResponse } from "next/server";
import { requireMinAccessLevelApi } from "@/lib/dal";
import { update, remove } from "@/lib/dal/open-source";
import { cardPatchSchema as patchSchema } from "../schema";

/** PATCH /api/open-source/[id] — update a card (admin only). */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const denied = await requireMinAccessLevelApi("admin");
  if (denied) return denied;

  const { id } = await params;

  const body = await req.json().catch(() => null);
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  try {
    const card = await update(id, parsed.data);
    return NextResponse.json({ card }, { status: 200 });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "update failed";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

/** DELETE /api/open-source/[id] — delete a card (admin only). */
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const denied = await requireMinAccessLevelApi("admin");
  if (denied) return denied;

  const { id } = await params;

  try {
    await remove(id);
    return new Response(null, { status: 204 });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "delete failed";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
