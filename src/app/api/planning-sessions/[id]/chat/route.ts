/**
 * Chat com Vitoria — Release Planning.
 *
 *   POST /api/planning-sessions/[id]/chat
 *     Envia mensagem, stream da resposta. Delega ao releasePlanningChatConnector.
 *
 *   GET  /api/planning-sessions/[id]/chat?limit=30&before=<iso>
 *     Carrega histórico do thread (agentName=sessionId, channel='release_planning').
 */
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireProjectViewApi } from "@/lib/dal";
import { getSession } from "@/lib/dal/planning-session";
import { releasePlanningChatConnector } from "@/lib/agent/connectors/release-planning-chat";

const DEFAULT_LIMIT = 30;
const MAX_LIMIT = 200;

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: sessionId } = await params;

  const session = await getSession(sessionId);
  if (!session) {
    return NextResponse.json({ error: "session not found" }, { status: 404 });
  }
  const denied = await requireProjectViewApi(session.projectId);
  if (denied) return denied;

  const limitParam = parseInt(
    req.nextUrl.searchParams.get("limit") || `${DEFAULT_LIMIT}`,
    10,
  );
  const limit = Math.max(
    1,
    Math.min(isNaN(limitParam) ? DEFAULT_LIMIT : limitParam, MAX_LIMIT),
  );
  const before = req.nextUrl.searchParams.get("before");

  const supabase = db();

  const { data: thread } = await supabase
    .from("ChatThread")
    .select("id")
    .eq("agentName", sessionId)
    .eq("channel", "release_planning")
    .order("createdAt", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!thread) {
    return NextResponse.json({ threadId: null, messages: [], hasMore: false });
  }

  let q = supabase
    .from("ChatMessage")
    .select("*")
    .eq("threadId", thread.id)
    .order("createdAt", { ascending: false })
    .limit(limit + 1);

  if (before) q = q.lt("createdAt", before);

  const { data: rows, error } = await q;
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const slice = rows ?? [];
  const hasMore = slice.length > limit;
  const trimmed = hasMore ? slice.slice(0, limit) : slice;
  const messages = trimmed.slice().reverse();

  return NextResponse.json({ threadId: thread.id, messages, hasMore });
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: sessionId } = await params;

  // Release planning aprovado é read-only — pra reabrir, o PM precisa de um novo.
  const session = await getSession(sessionId);
  if (!session) {
    return NextResponse.json({ error: "session not found" }, { status: 404 });
  }
  if (session.status === "approved") {
    return NextResponse.json(
      { error: "Release planning aprovado é read-only.", status: session.status },
      { status: 409 },
    );
  }

  return releasePlanningChatConnector.handle(req, sessionId);
}
