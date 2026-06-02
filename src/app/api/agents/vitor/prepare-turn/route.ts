import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { vitorAgent } from "@/lib/agent/agents/vitor";
import type { Capabilities } from "@/lib/agent/types";

export const dynamic = "force-dynamic";

const DEFAULT_CAPABILITIES: Capabilities = {
  maxSteps: 60,
  writeTools: true,
  readTools: true,
  webSearch: true,
};

/**
 * POST /api/agents/vitor/prepare-turn
 *
 * Chamado pelo daemon (exec-chat-turn.ts) no início de cada turn pra obter o
 * estado completo necessário pra invocar `claude -p`:
 *   - systemPrompt: prompt completo do Vitor com contexto da DS atual
 *     (current step, decisões, open questions, business context, etc.)
 *   - history: últimas N mensagens do thread em ordem cronológica
 *   - toolNames: nomes de tools que o agente espera ter disponíveis
 *
 * Reusa vitorAgent.loadContext + buildPrompt (mesma lógica do webConnector
 * tradicional). Single source of truth — quando o prompt do Vitor mudar no
 * webapp, a próxima prepare-turn do daemon pega automaticamente.
 *
 * Sem Bearer auth nesta fase (MVP local; daemon usa service_role).
 *
 * Body:
 *   { chatTurnId: string }
 *
 * Returns:
 *   {
 *     systemPrompt: string,
 *     history: Array<{ role: 'user'|'assistant', content: string }>,
 *     toolNames: string[],
 *     sessionId: string,
 *     projectId: string | null,
 *     currentStepKey: string
 *   }
 */
export async function POST(req: NextRequest): Promise<NextResponse> {
  const body = (await req.json().catch(() => ({}))) as {
    chatTurnId?: string;
  };
  if (!body.chatTurnId) {
    return NextResponse.json({ error: "chatTurnId required" }, { status: 400 });
  }

  const supabase = db();

  const { data: turn, error: turnErr } = await supabase
    .from("ChatTurn")
    .select("id, threadId, agentSlug, userMessageId")
    .eq("id", body.chatTurnId)
    .maybeSingle();
  if (turnErr || !turn) {
    return NextResponse.json({ error: "chat_turn_not_found" }, { status: 404 });
  }

  const { data: thread, error: threadErr } = await supabase
    .from("ChatThread")
    .select("id, sessionId, channel")
    .eq("id", turn.threadId)
    .maybeSingle();
  if (threadErr || !thread || !thread.sessionId) {
    return NextResponse.json({ error: "thread_not_found" }, { status: 404 });
  }

  // Step key heurística — DesignSession tem currentStepKey? Não temos coluna
  // explícita. webConnector usa `currentStepKey` vindo do body do client. Pra
  // prepare-turn, fazemos lookup de qual step a session está ativa.
  const { data: session } = await supabase
    .from("DesignSession")
    .select("id, projectId, currentStep, type")
    .eq("id", thread.sessionId)
    .maybeSingle();
  const currentStepKey =
    (session as { currentStep?: string | null } | null)?.currentStep ??
    "pre_work";

  // Carrega histórico (últimas 40 msgs) cronológico
  const { data: historyRows } = await supabase
    .from("ChatMessage")
    .select("role, content, createdAt")
    .eq("threadId", thread.id)
    .order("createdAt", { ascending: true })
    .limit(40);
  const history = (historyRows ?? [])
    .filter((m) => m.role === "user" || m.role === "assistant")
    .map((m) => ({ role: m.role as "user" | "assistant", content: m.content }));

  // Reusa loadContext + buildPrompt do agent definition
  const capabilities: Capabilities = {
    ...DEFAULT_CAPABILITIES,
    projectId: session?.projectId ?? undefined,
    memberId: undefined,
  };

  let agentContext: Record<string, unknown>;
  try {
    agentContext = await vitorAgent.loadContext({
      agent: vitorAgent,
      thread: { id: thread.id },
      capabilities,
      userMessage: "",
      memberId: null,
      params: {
        sessionId: thread.sessionId,
        currentStepKey,
      },
    });
  } catch (err) {
    return NextResponse.json(
      { error: "load_context_failed", details: String(err) },
      { status: 500 },
    );
  }

  const systemPromptResult = vitorAgent.buildPrompt({
    capabilities,
    agentContext,
    messageHistory: history,
  });
  // SystemPrompt vem split em stable + volatile (caching Anthropic).
  // Pra Claude CLI concatenamos — não tem cache estruturado nessa fase.
  const systemPrompt =
    `${systemPromptResult.stable}\n\n${systemPromptResult.volatile}`.trim();

  // toolNames: pra MVP retornamos vazio (registry da Story 13 vai listar).
  // Quando o MCP server pegar os mesmos nomes via `tools/list`, Claude já
  // descobre — não precisamos passar por aqui.
  const toolNames: string[] = [];

  return NextResponse.json({
    systemPrompt,
    history,
    toolNames,
    sessionId: thread.sessionId,
    projectId: session?.projectId ?? null,
    currentStepKey,
  });
}
