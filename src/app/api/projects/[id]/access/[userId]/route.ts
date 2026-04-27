import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireMinLevelApi } from "@/lib/dal";
import { MANAGER } from "@/lib/roles";

const ALLOWED_ROLES = [
  "viewer",
  "session_participant",
  "contributor",
  "lead",
] as const;
type AccessRole = (typeof ALLOWED_ROLES)[number];

/**
 * PATCH /api/projects/[id]/access/[userId]
 * Body: { role }
 * Manager-only. Updates the role on a single ProjectAccess row.
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; userId: string }> },
) {
  const denied = await requireMinLevelApi(MANAGER);
  if (denied) return denied;
  const { id: projectId, userId } = await params;
  const body = await req.json().catch(() => ({}));
  const role = body?.role as AccessRole | undefined;
  if (!role || !ALLOWED_ROLES.includes(role)) {
    return NextResponse.json({ error: "role inválido" }, { status: 400 });
  }
  const { error } = await db()
    .from("ProjectAccess")
    .update({ role })
    .eq("projectId", projectId)
    .eq("userId", userId);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}

/**
 * DELETE /api/projects/[id]/access/[userId]
 * Manager-only. Revokes access (deletes ProjectAccess row).
 * Doesn't touch ProjectMember — desalocação é decisão separada.
 */
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; userId: string }> },
) {
  const denied = await requireMinLevelApi(MANAGER);
  if (denied) return denied;
  const { id: projectId, userId } = await params;
  const { error } = await db()
    .from("ProjectAccess")
    .delete()
    .eq("projectId", projectId)
    .eq("userId", userId);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
