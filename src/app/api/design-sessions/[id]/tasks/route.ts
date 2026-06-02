import { NextRequest, NextResponse } from "next/server";
import { requireSessionAccessApi } from "@/lib/dal";
import { db } from "@/lib/db";

/**
 * GET /api/design-sessions/[id]/tasks
 * Returns the full task list linked to this session (drafts included).
 * Accepts ?countOnly=1 for a head-count used by older callers.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: sessionId } = await params;
  const denied = await requireSessionAccessApi(sessionId);
  if (denied) return denied;

  const countOnly = req.nextUrl.searchParams.get("countOnly") === "1";
  const supabase = db();

  if (countOnly) {
    const { count, error } = await supabase
      .from("Task")
      .select("id", { count: "exact", head: true })
      .eq("designSessionId", sessionId);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ count: count ?? 0 });
  }

  const { data: tasks, error } = await supabase
    .from("Task")
    .select(
      "*, project:Project(id, name), sprint:Sprint(id, name), assignments:TaskAssignment(*, member:Member(id, name))"
    )
    .eq("designSessionId", sessionId)
    .is("dismissedAt", null)
    .order("priority", { ascending: false })
    .order("createdAt", { ascending: true });

  if (error) {
    console.error("[GET /api/design-sessions/[id]/tasks]", sessionId, error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  console.log(
    `[GET /api/design-sessions/${sessionId}/tasks] returning ${(tasks ?? []).length} task(s)`
  );
  return NextResponse.json({ tasks: tasks ?? [], count: (tasks ?? []).length });
}
