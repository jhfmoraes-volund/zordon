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
import { requireProjectViewApi, getCurrentMember } from "@/lib/dal";
import { requireCapabilityApi } from "@/lib/access/require-capability";
import { getSession } from "@/lib/dal/planning-session";
import { releasePlanningChatConnector } from "@/lib/agent/connectors/release-planning-chat";
import { ensureReleasePlanningThread } from "@/lib/agent/context";
import {
  streamViaClaudeDaemon,
  isDaemonOnline,
} from "@/lib/agent/sse-chat-proxy";
import { getActiveChatTurnForThread } from "@/lib/dal/chat-turn";

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
    return NextResponse.json({
      threadId: null,
      messages: [],
      hasMore: false,
      activeTurn: null,
    });
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

  // Turn em andamento? O cliente usa isso pra, ao remontar, mostrar "pensando"
  // e reconectar ao stream (resumeStream) sem perder a geração em background.
  const activeTurn = await getActiveChatTurnForThread(thread.id);

  return NextResponse.json({ threadId: thread.id, messages, hasMore, activeTurn });
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

  // db() bypassa RLS — escrever no chat do ritual é operar o Planning.
  const denied = await requireCapabilityApi("ritual.planning", {
    projectId: session.projectId,
  });
  if (denied) return denied;

  if (session.status === "approved") {
    return NextResponse.json(
      { error: "Release planning aprovado é read-only.", status: session.status },
      { status: 409 },
    );
  }

  const member = await getCurrentMember();
  if (!member) return new NextResponse("Unauthorized", { status: 401 });

  // Branch por AgentMode('vitoria'). Default = claude-daemon (regra 2026-06:
  // daemon é o caminho padrão de todo chat; OpenRouter só fallback). Espelha
  // planning/[id]/chat. Se o daemon estiver offline, cai pro connector
  // OpenRouter e marca X-Mode-Fallback.
  const { data: modeRow } = await db()
    .from("AgentMode")
    .select("mode")
    .eq("userId", member.id)
    .eq("agentSlug", "vitoria")
    .maybeSingle();
  const mode = modeRow?.mode ?? "claude-daemon";

  if (mode === "claude-daemon") {
    if (!(await isDaemonOnline())) {
      const res = await releasePlanningChatConnector.handle(req, sessionId);
      res.headers.set("X-Mode-Fallback", "true");
      res.headers.set("X-Mode-Fallback-Reason", "daemon_offline");
      return res;
    }
    return handleClaudeDaemonChat(req, sessionId, member.id);
  }

  return releasePlanningChatConnector.handle(req, sessionId);
}

/**
 * Path claude-daemon: persiste a msg do PM, garante o thread do release
 * planning e delega ao SSE proxy (enfileira ChatTurn + ForgeJob(kind=chat) pro
 * daemon). Espelha o handleClaudeDaemonChat da Planning Ceremony.
 */
async function handleClaudeDaemonChat(
  req: NextRequest,
  sessionId: string,
  memberId: string,
): Promise<Response> {
  const body = await req.json();
  const { messages } = body as {
    messages?: Array<{
      role: string;
      content?: string;
      parts?: Array<{ type: string; text?: string }>;
    }>;
  };

  const lastUserMsg = [...(messages || [])]
    .reverse()
    .find((m) => m.role === "user");
  const message =
    lastUserMsg?.content ??
    lastUserMsg?.parts
      ?.filter((p) => p.type === "text")
      .map((p) => p.text)
      .join("\n") ??
    "";

  if (!message?.trim()) {
    return new NextResponse("Missing message", { status: 400 });
  }

  const threadId = await ensureReleasePlanningThread(sessionId, memberId);

  const supabase = db();
  const { data: userMessage, error: msgErr } = await supabase
    .from("ChatMessage")
    .insert({ threadId, role: "user", content: message })
    .select("id")
    .single();
  if (msgErr || !userMessage) {
    return NextResponse.json(
      { error: msgErr?.message ?? "Failed to persist user message" },
      { status: 500 },
    );
  }

  return streamViaClaudeDaemon({
    threadId,
    userMessageId: userMessage.id,
    agentSlug: "vitoria",
    ownerId: memberId,
  });
}
