import { NextResponse } from "next/server";

import { getUser } from "@/lib/dal";
import { requireCapabilityApi } from "@/lib/access/require-capability";
import { revokeGrant } from "@/lib/access/grants-dal";

/** DELETE → revoga (soft) um grant ativo (admin-only). */
export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const denied = await requireCapabilityApi("access_grant.manage");
  if (denied) return denied;
  const actor = await getUser();
  if (!actor) return new NextResponse("Unauthorized", { status: 401 });

  const { id } = await params;
  const { data, error } = await revokeGrant(id, actor.id);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if (!data) {
    // Já revogado ou inexistente — idempotente.
    return NextResponse.json({ error: "grant not found or already revoked" }, {
      status: 404,
    });
  }
  return NextResponse.json({ ok: true });
}
