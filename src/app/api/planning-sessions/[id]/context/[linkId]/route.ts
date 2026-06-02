/**
 * DELETE /api/planning-sessions/[id]/context/[linkId]
 * Remove o link entre ContextSource e o Release Planning (não apaga o ContextSource).
 */
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireProjectEditSessionsApi } from "@/lib/dal";
import { getSession } from "@/lib/dal/planning-session";

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; linkId: string }> },
) {
  const { id: sessionId, linkId } = await params;

  const session = await getSession(sessionId);
  if (!session) {
    return NextResponse.json({ error: "session not found" }, { status: 404 });
  }
  const denied = await requireProjectEditSessionsApi(session.projectId);
  if (denied) return denied;

  const { error } = await db()
    .from("EntityLink")
    .delete()
    .eq("id", linkId)
    .eq("planningSessionId", sessionId);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
