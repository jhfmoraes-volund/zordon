import { NextResponse } from "next/server";
import { getCurrentMember, requireMinLevelApi } from "@/lib/dal";
import { MANAGER } from "@/lib/roles";
import { db } from "@/lib/db";

/**
 * DELETE /api/agents/alpha/threads/[id]
 * Removes one of the current member's Alpha conversations.
 * Messages cascade via FK ON DELETE.
 */
export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const denied = await requireMinLevelApi(MANAGER);
  if (denied) return denied;

  const member = await getCurrentMember();
  if (!member) {
    return NextResponse.json({ error: "Member not found" }, { status: 403 });
  }

  const { id } = await params;

  const { error, count } = await db()
    .from("ChatThread")
    .delete({ count: "exact" })
    .eq("id", id)
    .eq("createdBy", member.id)
    .eq("agentName", "alpha");

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if (!count) {
    return NextResponse.json({ error: "Thread not found" }, { status: 404 });
  }

  return NextResponse.json({ ok: true });
}
