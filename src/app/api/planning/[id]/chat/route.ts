/**
 * Chat com Vitória — Copiloto de Rituais.
 *
 *   POST /api/planning/[id]/chat
 *     Envia mensagem, stream da resposta. Delega ao planningChatConnector.
 *
 *   GET  /api/planning/[id]/chat?limit=30&before=<iso>
 *     Carrega histórico do thread da planning (agentName=planningId, channel='planning').
 *     Keyset por createdAt DESC. Sem `before` → mensagens mais recentes.
 *     Com `before` → próximas mais antigas (infinite scroll).
 */
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireProjectViewApi, getCurrentMember } from "@/lib/dal";
import { getPlanningById } from "@/lib/dal/planning";
import { planningChatConnector } from "@/lib/agent/connectors/planning-chat";
import { ensurePlanningThread } from "@/lib/agent/context";
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
  const { id: planningId } = await params;

  const planning = await getPlanningById(planningId);
  if (!planning) {
    return NextResponse.json({ error: "Planning não encontrada" }, { status: 404 });
  }
  const denied = await requireProjectViewApi(planning.projectId);
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
    .eq("agentName", planningId)
    .eq("channel", "planning")
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

  const activeTurn = await getActiveChatTurnForThread(thread.id);

  return NextResponse.json({ threadId: thread.id, messages, hasMore, activeTurn });
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  // "1 planning viva por sprint": planning concluída/arquivada é read-only.
  // Pra editar, o PM precisa reabrir explicitamente (POST .../reopen). Evita
  // que a Vitoria crie propostas órfãs num plano já publicado.
  const planning = await getPlanningById(id);
  if (!planning) {
    return NextResponse.json({ error: "Planning não encontrada" }, { status: 404 });
  }
  if (planning.phase === "closed" || planning.phase === "archived") {
    return NextResponse.json(
      { error: "Reabra a planning pra editar.", phase: planning.phase },
      { status: 409 },
    );
  }

  const member = await getCurrentMember();
  if (!member) return new NextResponse("Unauthorized", { status: 401 });

  // Branch por AgentMode('vitoria'). Default = claude-daemon (regra 2026-06:
  // daemon é o caminho padrão de todo chat; OpenRouter só fallback). Linha
  // ausente → daemon (consistente com /api/agent-mode GET e a UI). Se o daemon
  // estiver offline, cai pro connector OpenRouter e marca X-Mode-Fallback.
  const { data: modeRow } = await db()
    .from("AgentMode")
    .select("mode")
    .eq("userId", member.id)
    .eq("agentSlug", "vitoria")
    .maybeSingle();
  const mode = modeRow?.mode ?? "claude-daemon";

  if (mode === "claude-daemon") {
    if (!(await isDaemonOnline())) {
      const res = await planningChatConnector.handle(req, id);
      res.headers.set("X-Mode-Fallback", "true");
      res.headers.set("X-Mode-Fallback-Reason", "daemon_offline");
      return res;
    }
    return handleClaudeDaemonChat(req, id, member.id);
  }

  return planningChatConnector.handle(req, id);
}

/**
 * Path claude-daemon: persiste a msg do PM, garante o thread da planning e
 * delega ao SSE proxy (enfileira ChatTurn + ForgeJob(kind=chat) pro daemon).
 * Espelha o handleClaudeDaemonChat do PM Review — mesma Response shape pro
 * useChat ler transparente.
 */
async function handleClaudeDaemonChat(
  req: NextRequest,
  planningId: string,
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

  const threadId = await ensurePlanningThread(planningId, memberId);

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
