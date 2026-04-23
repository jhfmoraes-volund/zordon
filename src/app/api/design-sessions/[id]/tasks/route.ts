import { NextRequest, NextResponse } from "next/server";
import { requireSessionAccessApi } from "@/lib/dal";
import { db } from "@/lib/db";

/**
 * GET /api/design-sessions/[id]/tasks
 * Returns the count of tasks linked to this design session.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: sessionId } = await params;
  const denied = await requireSessionAccessApi(sessionId);
  if (denied) return denied;

  const { count, error } = await db()
    .from("Task")
    .select("id", { count: "exact", head: true })
    .eq("designSessionId", sessionId);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ count: count ?? 0 });
}
