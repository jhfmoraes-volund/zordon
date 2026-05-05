import { NextRequest, NextResponse } from "next/server";
import { requireSessionAccessApi } from "@/lib/dal";
import { db } from "@/lib/db";

/**
 * POST /api/design-sessions/[id]/complete
 *
 * Marks a Design Session as completed. This is a status-only flip — task
 * promotion happens at module-approval time, not here.
 *
 * Pre-flight: blocks if any draft task remains. A draft task means there's
 * still work that hasn't been wrapped into an approved module — the user
 * needs to either approve the relevant module (which promotes the tasks) or
 * discard the story.
 */
export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: sessionId } = await params;
  const denied = await requireSessionAccessApi(sessionId);
  if (denied) return denied;

  const supabase = db();

  const { count: draftCount, error: countErr } = await supabase
    .from("Task")
    .select("id", { count: "exact", head: true })
    .eq("designSessionId", sessionId)
    .eq("status", "draft");
  if (countErr) {
    return NextResponse.json({ error: countErr.message }, { status: 500 });
  }
  if ((draftCount ?? 0) > 0) {
    return NextResponse.json(
      {
        error: "blocked",
        message: `${draftCount} task(s) ainda em rascunho. Aprove os módulos correspondentes ou descarte as stories antes de concluir.`,
        draftCount,
      },
      { status: 409 },
    );
  }

  const { error: sessionErr } = await supabase
    .from("DesignSession")
    .update({
      status: "completed",
      completedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    })
    .eq("id", sessionId);

  if (sessionErr) {
    return NextResponse.json({ error: sessionErr.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
