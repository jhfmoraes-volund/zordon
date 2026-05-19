import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireSessionEditApi } from "@/lib/dal";

/**
 * DELETE /api/design-sessions/[id]/transcripts/[transcriptId]
 *
 * Removes an imported transcript from the session. Defense-in-depth:
 * the WHERE clause pins both the row id AND the sessionId so a stale
 * URL from another session can't delete by accident.
 */
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; transcriptId: string }> },
) {
  const { id: sessionId, transcriptId } = await params;

  const denied = await requireSessionEditApi(sessionId);
  if (denied) return denied;

  const { error } = await db()
    .from("DesignSessionTranscript")
    .delete()
    .eq("id", transcriptId)
    .eq("sessionId", sessionId);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
