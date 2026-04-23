import { NextRequest, NextResponse } from "next/server";
import { requireSessionAccessApi } from "@/lib/dal";
import { db } from "@/lib/db";
import { webConnector } from "@/lib/agent/connectors/web";

export const maxDuration = 300;

/**
 * GET /api/design-sessions/[id]/chat?channel=web|briefing
 * Returns chat history for the session's thread in the given channel.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: sessionId } = await params;
  const denied = await requireSessionAccessApi(sessionId);
  if (denied) return denied;

  const channel = req.nextUrl.searchParams.get("channel") || "web";

  const { data: thread } = await db()
    .from("ChatThread")
    .select("id")
    .eq("sessionId", sessionId)
    .eq("channel", channel)
    .order("createdAt", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!thread) {
    return NextResponse.json({ threadId: null, messages: [] });
  }

  // Load messages
  const { data: messages } = await db()
    .from("ChatMessage")
    .select("*")
    .eq("threadId", thread.id)
    .order("createdAt", { ascending: true });

  return NextResponse.json({
    threadId: thread.id,
    messages: messages || [],
  });
}

/**
 * POST /api/design-sessions/[id]/chat
 * Sends a message and streams the AI response.
 * Delegates to the web connector.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: sessionId } = await params;
  const denied = await requireSessionAccessApi(sessionId);
  if (denied) return denied;
  return webConnector.handle(req, sessionId);
}
