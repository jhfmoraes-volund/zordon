/**
 * Chat com Vitoria — modo PM Review.
 *
 *   POST /api/pm-review/[id]/chat — stream da resposta.
 *   GET  /api/pm-review/[id]/chat?limit=30&before=<iso> — histórico do thread.
 *
 * Branch por AgentMode('vitoria'):
 *   - openrouter (default): pmReviewChatConnector (streamText AI SDK)
 *   - claude-daemon: streamViaClaudeDaemon (helper compartilhado — SSE proxy
 *     que enfileira ChatTurn pro daemon local). Mesma Response shape pra
 *     useChat ler transparente.
 */
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireProjectViewApi, getCurrentMember } from "@/lib/dal";
import { pmReviewChatConnector } from "@/lib/agent/connectors/pm-review-chat";
import { ensurePMReviewThread } from "@/lib/agent/context";
import {
  streamViaClaudeDaemon,
  isDaemonOnline,
} from "@/lib/agent/sse-chat-proxy";

const DEFAULT_LIMIT = 30;
const MAX_LIMIT = 200;

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: pmReviewId } = await params;

  const { data: pm } = await db()
    .from("PMReview")
    .select("projectId")
    .eq("id", pmReviewId)
    .maybeSingle();
  if (!pm)
    return NextResponse.json({ error: "PM Review não encontrado" }, { status: 404 });

  const denied = await requireProjectViewApi(pm.projectId);
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
    .eq("agentName", pmReviewId)
    .eq("channel", "pm_review")
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
  const { id: pmReviewId } = await params;

  const member = await getCurrentMember();
  if (!member) return new NextResponse("Unauthorized", { status: 401 });

  const supabase = db();
  const { data: pm } = await supabase
    .from("PMReview")
    .select("projectId")
    .eq("id", pmReviewId)
    .maybeSingle();
  if (!pm) {
    return NextResponse.json(
      { error: "PM Review não encontrado" },
      { status: 404 },
    );
  }
  const denied = await requireProjectViewApi(pm.projectId);
  if (denied) return denied;

  // Lookup AgentMode('vitoria'). Default = claude-daemon (regra 2026-06):
  // linha ausente → daemon, igual à UI (/api/agent-mode GET) e à planning.
  const { data: modeRow } = await supabase
    .from("AgentMode")
    .select("mode")
    .eq("userId", member.id)
    .eq("agentSlug", "vitoria")
    .maybeSingle();
  const mode = modeRow?.mode ?? "claude-daemon";

  if (mode === "claude-daemon") {
    if (!(await isDaemonOnline())) {
      const res = await pmReviewChatConnector.handle(req, pmReviewId);
      res.headers.set("X-Mode-Fallback", "true");
      res.headers.set("X-Mode-Fallback-Reason", "daemon_offline");
      return res;
    }
    return handleClaudeDaemonChat(req, pmReviewId, member.id);
  }

  return pmReviewChatConnector.handle(req, pmReviewId);
}

async function handleClaudeDaemonChat(
  req: NextRequest,
  pmReviewId: string,
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

  const threadId = await ensurePMReviewThread(pmReviewId, memberId);

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
