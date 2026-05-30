/**
 * DELETE /api/design-sessions/[id]/context/[linkId]
 * Remove o link entre ContextSource e DesignSession.
 * Não apaga o ContextSource em si (pode estar linkado a outros lugares).
 */
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireSessionEditApi } from "@/lib/dal";

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; linkId: string }> },
) {
  const { id: sessionId, linkId } = await params;

  const denied = await requireSessionEditApi(sessionId);
  if (denied) return denied;

  const supabase = db();

  // Delete link (WHERE pinning both id and sessionId for safety)
  const { error } = await supabase
    .from("DesignSessionContextLink")
    .delete()
    .eq("id", linkId)
    .eq("designsessionid", sessionId);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
