import { NextRequest, NextResponse } from "next/server";
import { requireSessionAccessApi } from "@/lib/dal";
import { db } from "@/lib/db";
import { webConnector } from "@/lib/agent/connectors/web";

export const maxDuration = 300;

const DEFAULT_LIMIT = 30;
const MAX_LIMIT = 200;

/**
 * GET /api/design-sessions/[id]/chat?channel=web&limit=30&before=<iso>&allFromBriefing=1
 *
 * Returns chat history for the session's thread (one thread per channel).
 *
 * Pagination strategy: keyset on createdAt DESC.
 *   - Without `before`: returns the most recent `limit` messages (default 30).
 *     Frontend renders these in chronological order (asc).
 *   - With `before=<iso>`: returns the next `limit` older messages (createdAt < before).
 *     Used by MessageList's infinite-scroll sentinel — chunks keep parse cost bounded.
 *
 * `hasMore` tells the frontend whether the top sentinel should keep firing.
 *
 * Special flag `allFromBriefing=1` (used by the briefing chat on first mount):
 *   instead of returning ANY recent message from the thread, returns ONLY messages
 *   created at or after a marker stored in DesignSession.briefingFirstMessageAt.
 *   When the marker doesn't exist yet, returns an empty array (briefing visually starts
 *   clean — even though the underlying thread may already contain pre_work / vision /
 *   brainstorm conversations).
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: sessionId } = await params;
  const denied = await requireSessionAccessApi(sessionId);
  if (denied) return denied;

  const channel = req.nextUrl.searchParams.get("channel") || "web";
  const limitParam = parseInt(
    req.nextUrl.searchParams.get("limit") || `${DEFAULT_LIMIT}`,
    10,
  );
  const limit = Math.max(1, Math.min(isNaN(limitParam) ? DEFAULT_LIMIT : limitParam, MAX_LIMIT));
  const before = req.nextUrl.searchParams.get("before");
  const briefingScope = req.nextUrl.searchParams.get("allFromBriefing") === "1";

  const supabase = db();

  const { data: thread } = await supabase
    .from("ChatThread")
    .select("id")
    .eq("sessionId", sessionId)
    .eq("channel", channel)
    .order("createdAt", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!thread) {
    return NextResponse.json({ threadId: null, messages: [], hasMore: false });
  }

  // Resolve briefing-scope marker.
  let briefingFromIso: string | null = null;
  if (briefingScope) {
    const { data: sessionRow } = await supabase
      .from("DesignSession")
      .select("briefingFirstMessageAt")
      .eq("id", sessionId)
      .maybeSingle();
    briefingFromIso = sessionRow?.briefingFirstMessageAt ?? null;
    if (!briefingFromIso) {
      // No briefing turn happened yet — return zero messages, signal no more.
      return NextResponse.json({
        threadId: thread.id,
        messages: [],
        hasMore: false,
        briefingPending: true,
      });
    }
  }

  // Build the windowed query: most recent `limit` (createdAt DESC), filter by cursor.
  let q = supabase
    .from("ChatMessage")
    .select("*")
    .eq("threadId", thread.id)
    .order("createdAt", { ascending: false })
    .limit(limit + 1); // +1 to detect hasMore without a count query

  if (before) q = q.lt("createdAt", before);
  if (briefingFromIso) q = q.gte("createdAt", briefingFromIso);

  const { data: rows, error } = await q;
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const slice = rows ?? [];
  const hasMore = slice.length > limit;
  const trimmed = hasMore ? slice.slice(0, limit) : slice;
  // Send chronological asc — UI expects oldest first.
  const messages = trimmed.slice().reverse();

  return NextResponse.json({
    threadId: thread.id,
    messages,
    hasMore,
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
