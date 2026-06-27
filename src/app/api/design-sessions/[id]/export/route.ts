import { NextRequest, NextResponse } from "next/server";
import { requireSessionEditApi } from "@/lib/dal";
import { db } from "@/lib/db";

/**
 * POST /api/design-sessions/[id]/export
 * Exports draft tasks generated during the session into the project's backlog.
 * Status flips draft → backlog (refs are stable <KEY>-T-NNN since creation).
 * Then marks the session as completed. Idempotent: already-exported tasks are
 * ignored, so the endpoint can be retried safely on partial failure.
 */
export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: sessionId } = await params;
  const denied = await requireSessionEditApi(sessionId);
  if (denied) return denied;

  const supabase = db();

  const { data: drafts, error: draftsError } = await supabase
    .from("Task")
    .select("id, functionPoints")
    .eq("designSessionId", sessionId)
    .eq("status", "draft")
    .order("createdAt", { ascending: true });

  if (draftsError) {
    return NextResponse.json({ error: draftsError.message }, { status: 500 });
  }

  let exported = 0;
  let totalFp = 0;

  if (drafts && drafts.length > 0) {
    const { error: updateError } = await supabase
      .from("Task")
      .update({ status: "backlog", updatedAt: new Date().toISOString() })
      .in(
        "id",
        drafts.map((d) => d.id),
      );
    if (updateError) {
      return NextResponse.json({ error: updateError.message }, { status: 500 });
    }
    exported = drafts.length;
    totalFp = drafts.reduce((sum, t) => sum + (t.functionPoints ?? 0), 0);
  }

  const { error: sessionError } = await supabase
    .from("DesignSession")
    .update({
      status: "completed",
      completedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    })
    .eq("id", sessionId);

  if (sessionError) {
    return NextResponse.json({ error: sessionError.message }, { status: 500 });
  }

  return NextResponse.json({ exported, totalFp });
}
