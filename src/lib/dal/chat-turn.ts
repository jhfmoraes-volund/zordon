// Sem "server-only": esse DAL é consumido tanto por rotas Next.js (server)
// quanto por exec-chat-turn.ts (CLI Node, repo zordon-daemon que espelha este arquivo). server-only é
// proteção do Next pra impedir leak em Client Components — não se aplica
// em CLI.
import { db } from "@/lib/db";
import { createJob } from "@/lib/forge/dal/job";
import type { Database, Json } from "@/lib/supabase/database.types";

type ChatTurnRow = Database["public"]["Tables"]["ChatTurn"]["Row"];

/**
 * Creates a ChatTurn (status=queued) + paired ForgeJob (kind=chat).
 *
 * `systemPrompt` is intentionally empty at creation time — the daemon
 * (exec-chat-turn.ts) calls `/api/agents/<slug>/prepare-turn` when it starts
 * running the turn, which fetches the live system prompt assembled with
 * current session context. The placeholder is updated then.
 *
 * Returns both IDs so the caller can return chatTurnId to the UI (for
 * Realtime subscribe) and the jobId stays as audit trail.
 */
export async function createChatTurnAndJob(args: {
  threadId: string;
  userMessageId: string;
  agentSlug: string;
  ownerId: string;
}): Promise<{ chatTurnId: string; jobId: string }> {
  const chatTurnId = await createChatTurn(args);
  const jobId = await enqueueChatJob({
    chatTurnId,
    agentSlug: args.agentSlug,
    ownerId: args.ownerId,
  });
  return { chatTurnId, jobId };
}

/**
 * Cria apenas o ChatTurn (status=queued). Não enfileira job — quem chamar é
 * responsável por chamar `enqueueChatJob` depois (em geral via SSE proxy que
 * precisa subscribe ao broadcast ANTES do daemon começar a empurrar deltas).
 */
export async function createChatTurn(args: {
  threadId: string;
  userMessageId: string;
  agentSlug: string;
  /** Página onde o PM está (currentPath). Persistida per-turn pro tool router
   *  resolver routeProjectId/routeSprintId das tools route-scoped do Alpha
   *  (Fase 2). Null = global. */
  routePath?: string | null;
  /** Params resolvidos do Ritual Playbook (audienceFloor + emphasisSections),
   *  lidos pelo prepare-turn. Null = sem playbook (comportamento padrão). */
  turnParams?: Json | null;
}): Promise<string> {
  const supabase = db();
  const { data: turn, error: turnErr } = await supabase
    .from("ChatTurn")
    .insert({
      threadId: args.threadId,
      userMessageId: args.userMessageId,
      agentSlug: args.agentSlug,
      mode: "claude-daemon",
      systemPrompt: "", // hydrated by daemon via prepare-turn
      status: "queued",
      routePath: args.routePath ?? null,
      turnParams: args.turnParams ?? null,
    })
    .select("id")
    .single();
  if (turnErr || !turn) {
    throw turnErr ?? new Error("Failed to create ChatTurn");
  }
  return turn.id;
}

/**
 * Enfileira ForgeJob(kind=chat) apontando pra um ChatTurn existente.
 * Daemon pega via claim loop.
 */
export async function enqueueChatJob(args: {
  chatTurnId: string;
  agentSlug: string;
  ownerId: string;
  /** Thread do chat — o daemon serializa turns do MESMO thread (pool concorrente
   *  entre threads distintos, serial dentro do thread). Aditivo: meta.threadId. */
  threadId?: string;
}): Promise<string> {
  const job = await createJob({
    ownerId: args.ownerId,
    prdSlug: `chat:${args.agentSlug}`,
    projectId: null,
    runId: null,
    status: "queued",
    assignToAnyone: true,
    kind: "chat",
    meta: { chatTurnId: args.chatTurnId, ...(args.threadId ? { threadId: args.threadId } : {}) },
  });
  return job.id;
}

/**
 * Get ChatTurn by ID (server-side; bypasses RLS for daemon access).
 */
export async function getChatTurn(id: string): Promise<ChatTurnRow | null> {
  const { data, error } = await db()
    .from("ChatTurn")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;
  return data ?? null;
}

// ─── Daemon-side helpers (chamadas por exec-chat-turn.ts) ───────────────────

/**
 * Transition queued → running. Sets startedAt + claimedBy.
 * Idempotente: só atualiza se status='queued'.
 */
export async function markChatTurnRunning(
  turnId: string,
  daemonId: string,
): Promise<void> {
  const { error } = await db()
    .from("ChatTurn")
    .update({
      status: "running",
      claimedBy: daemonId,
      startedAt: new Date().toISOString(),
    })
    .eq("id", turnId)
    .eq("status", "queued");
  if (error) console.warn(`[chat-turn] markRunning(${turnId}) failed:`, error);
}

/**
 * UPDATE systemPrompt no início do run (após prepare-turn hidratar contexto).
 * Não muda status — apenas snapshota o prompt usado.
 */
export async function setChatTurnSystemPrompt(
  turnId: string,
  systemPrompt: string,
): Promise<void> {
  const { error } = await db()
    .from("ChatTurn")
    .update({ systemPrompt })
    .eq("id", turnId);
  if (error) console.warn(`[chat-turn] setSystemPrompt(${turnId}) failed:`, error);
}

/**
 * Append 1 evento no stream do turn (text_delta, tool_use, tool_result, etc.).
 *
 * Seq atribuído server-side via MAX(seq)+1 dentro de retry loop pra evitar
 * colisão entre múltiplos emissores (mesmo padrão do ForgeEvent writer).
 *
 * Retorna o seq atribuído. Em caso de erro persistente, lança.
 */
export async function appendChatTurnEvent(
  turnId: string,
  kind: string,
  payload: Record<string, unknown> = {},
): Promise<number> {
  const supabase = db();
  let attempt = 0;
  while (attempt < 3) {
    attempt += 1;
    const { data: max } = await supabase
      .from("ChatTurnEvent")
      .select("seq")
      .eq("turnId", turnId)
      .order("seq", { ascending: false })
      .limit(1)
      .maybeSingle();
    const nextSeq = (max?.seq ?? 0) + 1;
    const { error } = await supabase.from("ChatTurnEvent").insert({
      turnId,
      seq: nextSeq,
      kind,
      payload: payload as never,
    });
    if (!error) return nextSeq;
    // 23505 = unique_violation → outra escrita ganhou; refetch e tenta de novo
    const code = (error as { code?: string }).code;
    if (code !== "23505") {
      console.error("[chat-turn] appendEvent failed:", error);
      throw error;
    }
  }
  throw new Error(`appendChatTurnEvent: gave up after 3 attempts (turn=${turnId})`);
}

/**
 * Conclui turn: insere ChatMessage(role=assistant) e marca ChatTurn done +
 * popula responseMessageId. Idempotente — só age se status NOT IN (done,error,aborted).
 */
export async function completeChatTurn(
  turnId: string,
  args: {
    responseText: string;
    tokensIn?: number;
    tokensOut?: number;
    costUsd?: number;
  },
): Promise<void> {
  const supabase = db();

  const { data: turn } = await supabase
    .from("ChatTurn")
    .select("id, threadId, status")
    .eq("id", turnId)
    .maybeSingle();

  if (!turn) throw new Error(`ChatTurn ${turnId} not found`);
  if (["done", "error", "aborted"].includes(turn.status)) return;

  // 1. Persist final assistant message
  const { data: msg, error: msgErr } = await supabase
    .from("ChatMessage")
    .insert({
      threadId: turn.threadId,
      role: "assistant",
      content: args.responseText,
    })
    .select("id")
    .single();
  if (msgErr || !msg) {
    throw msgErr ?? new Error("Failed to persist assistant message");
  }

  // 2. Mark turn done
  const { error } = await supabase
    .from("ChatTurn")
    .update({
      status: "done",
      endedAt: new Date().toISOString(),
      responseMessageId: msg.id,
      tokensIn: args.tokensIn ?? null,
      tokensOut: args.tokensOut ?? null,
      costUsd: args.costUsd ?? null,
    })
    .eq("id", turnId)
    .not("status", "in", '("done","error","aborted")');
  if (error) console.warn(`[chat-turn] complete(${turnId}) failed:`, error);
}

// ─── Session continuity (Pilar 1+2) ────────────────────────────────────────

export type ChatThreadSessionState = {
  threadId: string;
  ccSessionId: string | null;
  turnsSinceCompact: number;
  lastSummary: string | null;
  lastCompactAt: string | null;
};

/**
 * Lê estado de session do thread pra decidir se o daemon usa `resume`
 * (sessionId existe) ou inicia fresh (com lastSummary como bootstrap).
 */
export async function getChatThreadSessionState(
  threadId: string,
): Promise<ChatThreadSessionState | null> {
  const { data, error } = await db()
    .from("ChatThread")
    .select("id, ccSessionId, turnsSinceCompact, lastSummary, lastCompactAt")
    .eq("id", threadId)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  return {
    threadId: data.id,
    ccSessionId: data.ccSessionId,
    turnsSinceCompact: data.turnsSinceCompact ?? 0,
    lastSummary: data.lastSummary,
    lastCompactAt: data.lastCompactAt,
  };
}

/**
 * Salva sessionId capturado da resposta da SDK na 1ª turn do thread.
 * Incrementa turnsSinceCompact em qualquer turn (1ª inclusive).
 */
export async function saveChatThreadSession(args: {
  threadId: string;
  ccSessionId: string;
  incrementTurns: boolean;
}): Promise<void> {
  const supabase = db();
  // Lê valor atual pra incremento atômico (Supabase JS não tem rpc.add).
  const { data: row } = await supabase
    .from("ChatThread")
    .select("turnsSinceCompact")
    .eq("id", args.threadId)
    .maybeSingle();
  const next = (row?.turnsSinceCompact ?? 0) + (args.incrementTurns ? 1 : 0);
  const { error } = await supabase
    .from("ChatThread")
    .update({
      ccSessionId: args.ccSessionId,
      turnsSinceCompact: next,
    })
    .eq("id", args.threadId);
  if (error) console.warn(`[chat-thread] saveSession(${args.threadId}) failed:`, error);
}

/**
 * Limpa o ccSessionId morto sem mexer em summary/contador. Usado quando o
 * resume falha porque a sessão CC sumiu (pruned) ou o cwd mudou (workspace
 * terraformado após o chat começar) — a próxima turn recomeça fresh.
 */
export async function clearChatThreadSession(threadId: string): Promise<void> {
  const { error } = await db()
    .from("ChatThread")
    .update({ ccSessionId: null })
    .eq("id", threadId);
  if (error)
    console.warn(`[chat-thread] clearSession(${threadId}) failed:`, error);
}

/**
 * Aplica compact: salva summary, zera sessionId (próxima turn fresh), zera contador.
 */
export async function applyChatThreadCompact(args: {
  threadId: string;
  summary: string;
}): Promise<void> {
  const { error } = await db()
    .from("ChatThread")
    .update({
      ccSessionId: null,
      lastSummary: args.summary,
      lastCompactAt: new Date().toISOString(),
      turnsSinceCompact: 0,
    })
    .eq("id", args.threadId);
  if (error) console.warn(`[chat-thread] applyCompact(${args.threadId}) failed:`, error);
}

/**
 * Marca turn como error/aborted. Idempotente.
 */
export async function failChatTurn(
  turnId: string,
  args: {
    errorReason: string;
    status?: "error" | "aborted";
  },
): Promise<void> {
  const { error } = await db()
    .from("ChatTurn")
    .update({
      status: args.status ?? "error",
      endedAt: new Date().toISOString(),
      errorReason: args.errorReason,
    })
    .eq("id", turnId)
    .not("status", "in", '("done","error","aborted")');
  if (error) console.warn(`[chat-turn] fail(${turnId}) failed:`, error);
}
