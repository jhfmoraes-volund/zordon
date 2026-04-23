import { NextRequest, NextResponse } from "next/server";
import { getCurrentMember, requireSessionAccessApi } from "@/lib/dal";
import { db } from "@/lib/db";
import { ensureThread } from "@/lib/agent/context";

/**
 * GET /api/design-sessions/[id]/chat/threads
 * Lists all chat threads for a session.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: sessionId } = await params;
  const denied = await requireSessionAccessApi(sessionId);
  if (denied) return denied;

  const { data: threads } = await db()
    .from("ChatThread")
    .select("*")
    .eq("sessionId", sessionId)
    .order("updatedAt", { ascending: false });

  return NextResponse.json({ threads: threads || [] });
}

/**
 * POST /api/design-sessions/[id]/chat/threads
 * Creates a new chat thread (or returns existing one for the channel).
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: sessionId } = await params;
  const denied = await requireSessionAccessApi(sessionId);
  if (denied) return denied;
  const body = await req.json();
  const channel = body.channel || "web";

  const member = await getCurrentMember();
  const threadId = await ensureThread(sessionId, channel, member?.id);

  return NextResponse.json({ threadId });
}
