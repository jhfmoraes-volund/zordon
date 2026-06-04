#!/usr/bin/env -S npx tsx
/**
 * exec-chat-turn.ts — executor de ChatTurn (kind='chat') no daemon local.
 *
 * Recebe `chatTurnId` via argv, lê ChatTurn + history do DB, spawna
 * `claude -p` com stream-json, persiste deltas em ChatTurnEvent e ao final
 * cria ChatMessage(role=assistant) + marca ChatTurn done.
 *
 * Nesta fase (Story 5):
 *   - SEM MCP (Story 11 conecta --mcp-config)
 *   - SEM prepare-turn (Story 14 hidrata systemPrompt + tools + history)
 *   - Prompt é simples: "Você é Vitor" + última mensagem do user
 *
 * Usage:
 *   tsx scripts/daemon/exec-chat-turn.ts <chatTurnId>
 *
 * Env:
 *   CHAT_MAX_TURNS=80     # mesmo default do Forge
 *   DAEMON_ID=<uuid>      # identifica daemon dono do turn
 */

import "dotenv/config";
import { resolve } from "node:path";
import { query } from "@anthropic-ai/claude-agent-sdk";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { db } from "../../src/lib/db";
import {
  appendChatTurnEvent,
  applyChatThreadCompact,
  clearChatThreadSession,
  completeChatTurn,
  failChatTurn,
  getChatThreadSessionState,
  markChatTurnRunning,
  saveChatThreadSession,
  setChatTurnSystemPrompt,
} from "../../src/lib/dal/chat-turn";
import { buildChatPrompt, type ChatContext } from "./chat-prompts";

const ZORDON_URL = process.env.ZORDON_URL ?? "http://localhost:3333";

const chatTurnId = process.argv[2];
const daemonId = process.env.DAEMON_ID ?? null;

// Broadcast channel — pub/sub efêmero pra UI receber deltas em tempo real.
// Separado da persistência (ChatTurnEvent) que serve só pra audit/replay.
let broadcastChannel: RealtimeChannel | null = null;

async function ensureBroadcastChannel(turnId: string): Promise<RealtimeChannel> {
  if (broadcastChannel) return broadcastChannel;
  const sb = db();
  const ch = sb.channel(`chat-turn-${turnId}`, {
    config: { broadcast: { self: false, ack: false } },
  });
  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(
      () => reject(new Error("broadcast subscribe timeout (5s)")),
      5000,
    );
    ch.subscribe((status) => {
      if (status === "SUBSCRIBED") {
        clearTimeout(timeout);
        resolve();
      } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
        clearTimeout(timeout);
        reject(new Error(`broadcast subscribe failed: ${status}`));
      }
    });
  });
  broadcastChannel = ch;
  return ch;
}

async function broadcast(event: string, payload: Record<string, unknown>) {
  try {
    if (!broadcastChannel) return; // não bloqueia se canal não estabeleceu
    await broadcastChannel.send({ type: "broadcast", event, payload });
  } catch (err) {
    console.error(`[exec-chat-turn] broadcast(${event}) failed:`, err);
  }
}

if (!chatTurnId) {
  console.error("Usage: tsx scripts/daemon/exec-chat-turn.ts <chatTurnId>");
  process.exit(2);
}

// ── Helpers de log + safe-emit ──────────────────────────────────────────────

function dim(s: string) {
  return `\x1b[2m${s}\x1b[0m`;
}
function cyan(s: string) {
  return `\x1b[36m${s}\x1b[0m`;
}

async function safeEmit(kind: string, payload: Record<string, unknown> = {}) {
  try {
    await appendChatTurnEvent(chatTurnId!, kind, payload);
  } catch (err) {
    console.error(`[exec-chat-turn] emit(${kind}) failed:`, err);
  }
}

// ── Main flow ───────────────────────────────────────────────────────────────

async function main() {
  console.log(cyan(`→ exec-chat-turn ${chatTurnId}`));

  const supabase = db();

  // 1. Carrega ChatTurn + history do thread
  const { data: turn, error: turnErr } = await supabase
    .from("ChatTurn")
    .select("id, threadId, agentSlug, status, systemPrompt, userMessageId")
    .eq("id", chatTurnId!)
    .maybeSingle();

  if (turnErr || !turn) {
    console.error("ChatTurn not found:", turnErr);
    process.exit(2);
  }

  if (turn.status !== "queued") {
    console.warn(`ChatTurn already in status='${turn.status}' — skipping.`);
    process.exit(0);
  }

  // 2. Carrega mensagens do thread em ordem cronológica
  const { data: history } = await supabase
    .from("ChatMessage")
    .select("id, role, content, createdAt")
    .eq("threadId", turn.threadId)
    .order("createdAt", { ascending: true })
    .limit(40);

  const lastUser = [...(history ?? [])]
    .reverse()
    .find((m) => m.role === "user");
  if (!lastUser?.content) {
    await failChatTurn(chatTurnId!, {
      errorReason: "no_user_message_found",
    });
    console.error("No user message found in thread.");
    process.exit(2);
  }

  // 3. Marca running + emite started + estabelece canal de broadcast
  if (daemonId) await markChatTurnRunning(chatTurnId!, daemonId);
  await safeEmit("started", {
    agentSlug: turn.agentSlug,
    historyCount: history?.length ?? 0,
  });

  // Broadcast channel — UI subscreve no mesmo nome pra receber deltas live.
  // Falha silenciosa: se não conseguir, fluxo continua (UI cai no fallback).
  try {
    await ensureBroadcastChannel(chatTurnId!);
    await broadcast("started", { agentSlug: turn.agentSlug });
  } catch (err) {
    console.error("[exec-chat-turn] broadcast setup failed:", err);
  }

  // 4. Lê estado de session do thread — define se vamos `resume` ou fresh.
  const sessionState = await getChatThreadSessionState(turn.threadId);
  const hasResumableSession = !!sessionState?.ccSessionId;

  // 5. Hidrata prompt LEVE via prepare-context (~1-2KB JSON de fatos vivos)
  //    + buildChatPrompt (~500-800 tokens identidade+estado+tools+estilo).
  //    Substitui o prepare-turn antigo (~20KB de instruções OpenRouter) —
  //    aquele continua existindo intocado pro path /chat openrouter.
  //    Em resume, este systemPrompt SÓ é usado na 1ª turn (depois Claude
  //    tem memória nativa via sessionId).
  const prepareUrl = `${ZORDON_URL}/api/agents/${turn.agentSlug}/prepare-context`;
  let systemPrompt = DEFAULT_SYSTEM_PROMPT;
  let workspacePath: string | null = null;
  try {
    const res = await fetch(prepareUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chatTurnId }),
    });
    if (res.ok) {
      const ctx = (await res.json()) as ChatContext;
      systemPrompt = buildChatPrompt(ctx);
      // Read-grounded: se projeto tem workspace clonado no FORGE_HOME, daemon
      // usa essa pasta como cwd → Vitor pode Read/Grep/Glob no código real.
      const projectWithWs = (ctx as { project?: { workspacePath?: string | null } }).project;
      workspacePath = projectWithWs?.workspacePath ?? null;
      await setChatTurnSystemPrompt(chatTurnId!, systemPrompt);
      await safeEmit("prepare_turn_ok", {
        systemPromptLen: systemPrompt.length,
        resume: hasResumableSession,
        mode: "light-prompt",
        workspacePath,
      });
    } else {
      await safeEmit("prepare_turn_fallback", {
        status: res.status,
        reason: "prepare-context returned non-OK; using DEFAULT prompt",
      });
    }
  } catch (err) {
    await safeEmit("prepare_turn_fallback", {
      reason: `network: ${(err as Error).message}`,
    });
  }

  // 6. Monta prompt:
  //    - Resume (Claude tem memória nativa via sessionId): só msg nova
  //    - Fresh (1ª turn ou pós-compact): system leve + summary (se houver)
  //      + bootstrap mínimo de history (apenas pra threads pré-migração,
  //      sem session ainda) + msg
  // Prompt fresh (system leve + summary/history bootstrap + msg nova). Em
  // closure porque o fallback de resume-stale (sessão CC sumiu / cwd mudou)
  // precisa reconstruir o prompt fresh pra retry sem perder a conversa.
  const buildFreshPrompt = (): string => {
    const summaryBlock =
      sessionState?.lastSummary && sessionState.lastSummary.length > 0
        ? `\n\n---\n**Resumo da conversa anterior:** ${sessionState.lastSummary}`
        : "";

    // Bootstrap mínimo: pra threads pré-migração (já com msgs mas sem
    // session), injeta últimas 10 msgs como contexto inicial. Depois do
    // 1º turn isso vira automático via resume.
    const priorMessages = (history ?? []).filter(
      (m) => m.id !== turn.userMessageId,
    );
    const historyBlock =
      !sessionState?.lastSummary && priorMessages.length > 0
        ? `\n\n---\n**Conversa recente (contexto inicial):**\n${priorMessages
            .slice(-10)
            .map((m) => `_${m.role}:_ ${m.content}`)
            .join("\n\n")}`
        : "";

    return `${systemPrompt}${summaryBlock}${historyBlock}\n\n---\n**Mensagem do João:** ${lastUser!.content}`;
  };

  // Resume (Claude tem memória nativa via sessionId) só manda a msg nova;
  // fresh manda o prompt completo.
  const prompt = hasResumableSession ? lastUser!.content : buildFreshPrompt();

  // 5. Roda Claude via SDK programático (não spawn da CLI).
  //    SDK usa MESMA binary, MESMA auth (~/.claude/), MESMA subscription.
  //    Diferença chave: `includePartialMessages: true` libera streaming
  //    token-a-token (eventos content_block_delta), enquanto `claude -p`
  //    buffera mensagens completas.
  const repoRoot = process.cwd();
  const mcpServerPath = resolve(repoRoot, "scripts/daemon/mcp-server.ts");
  const maxTurns = Number(process.env.CHAT_MAX_TURNS ?? "80");

  console.log(dim(`  SDK query (max_turns=${maxTurns}, mcp=zordon stdio)`));

  // streamTurn: roda 1 query (resume ou fresh) e acumula o resultado do
  // stream. Extraído pra permitir retry fresh quando o resume falha porque a
  // sessão CC não existe mais (ver fallback de resume-stale abaixo).
  const streamTurn = async (turnPrompt: string, resumeId: string | null) => {
    let assistantText = "";
    let tokensIn: number | null = null;
    let tokensOut: number | null = null;
    let costUsd: number | null = null;
    let resultSubtype: string | null = null;
    let capturedSessionId: string | null = null;

    const response = query({
      prompt: turnPrompt,
      options: {
        includePartialMessages: true,
        maxTurns,
        // Raciocínio nativo (thinking adaptive): Claude decide quando pensar.
        // O streaming separa thinking_delta (raciocínio, canal próprio) de
        // text_delta (resposta) — a UI renderiza o raciocínio num bloco
        // colapsável "Pensando…" e a resposta limpa em PT no balão. Sem isso,
        // o modelo narra o raciocínio dentro do texto da resposta.
        thinking: { type: "adaptive", display: "summarized" },
        // Resume nativo: Claude lembra de turns anteriores. Sem isso, daemon
        // seria stateless e cairia em loops "ler + propor + esperar ok" pq
        // o "ok" do user some na janela de history.
        ...(resumeId ? { resume: resumeId } : {}),
        // cwd ESTÁVEL = repoRoot. NÃO usar workspacePath aqui: o CC deriva o
        // diretório de busca da sessão a partir do cwd, então mudar o cwd
        // (ex: workspace terraformado depois do chat começar) faz o resume
        // não achar a sessão e o turn morrer com "No conversation found".
        // As tools de workspace usam ctx.workspacePath (resolvido server-side
        // via prepare-context), não process.cwd() — então o cwd não as afeta.
        cwd: repoRoot,
        // Whitelist explícita: APENAS mcp__zordon__*.
        // Read/Grep/Glob nativos do CC SDK FICAM disallowed — aceitam
        // path absoluto e atravessam o disco inteiro (cwd só seta
        // starting point). Pra leitura de código usamos as variantes
        // mcp__zordon__read_workspace_file / glob_workspace /
        // grep_workspace que VALIDAM o path contra o prefix do workspace.
        allowedTools: [
          "mcp__zordon__read_workspace_file",
          "mcp__zordon__glob_workspace",
          "mcp__zordon__grep_workspace",
          "mcp__zordon__read_product_vision",
          "mcp__zordon__read_scope",
          "mcp__zordon__read_persona",
          "mcp__zordon__read_brainstorm",
          "mcp__zordon__read_priority",
          "mcp__zordon__read_risk",
          "mcp__zordon__read_gap",
          "mcp__zordon__read_tech_specs",
          "mcp__zordon__read_hypothesis",
          "mcp__zordon__write_product_vision",
          "mcp__zordon__write_scope_item",
          "mcp__zordon__write_persona",
          "mcp__zordon__write_brainstorm",
          "mcp__zordon__write_priority",
          "mcp__zordon__write_risk",
          "mcp__zordon__write_gap",
          "mcp__zordon__write_tech_specs",
          "mcp__zordon__write_hypothesis",
          "mcp__zordon__read_business_context",
          "mcp__zordon__read_session_memory",
          "mcp__zordon__update_session_memory",
          "mcp__zordon__read_project_memory",
          "mcp__zordon__update_project_memory",
          "mcp__zordon__record_decision",
          "mcp__zordon__revise_decision",
          "mcp__zordon__list_decisions",
          "mcp__zordon__add_open_question",
          "mcp__zordon__resolve_open_question",
          "mcp__zordon__list_open_questions",
          "mcp__zordon__read_context_source",
          "mcp__zordon__propose_prd",
          "mcp__zordon__read_prd",
          "mcp__zordon__update_prd",
          "mcp__zordon__approve_prd",
          "mcp__zordon__link_prd_dependency",
          "mcp__zordon__list_prds",
          "mcp__zordon__read_transcript_content",
          "mcp__zordon__add_pm_review_note",
          "mcp__zordon__update_pm_review_report",
          "mcp__zordon__get_project_indicators",
        ],
        // Guard-rail explícito: bloqueia tools que Claude conhece do training
        // mas NÃO temos plugadas (Google Drive, Notion, Slack, etc) — sem
        // isso ele tenta invocar `mcp__google_drive__*` e trava o turno.
        // Não cobre tools desconhecidas (allowedTools acima é authoritative),
        // mas elimina os candidatos óbvios + serve de sinal pro modelo.
        disallowedTools: [
          "Bash",
          "Write",
          "Edit",
          "MultiEdit",
          "NotebookEdit",
          "Read",
          "Grep",
          "Glob",
          "WebSearch",
          "WebFetch",
        ],
        // Daemon roda local trusted, sem humano no loop. Tool router valida
        // ctx (member/session/project) no servidor — sem prompt de permissão.
        permissionMode: "bypassPermissions",
        mcpServers: {
          zordon: {
            type: "stdio",
            command: "npx",
            args: ["tsx", mcpServerPath],
            env: {
              AGENT_SLUG: turn.agentSlug,
              CHAT_TURN_ID: chatTurnId!,
            },
            // Pre-carrega TODAS as tools no prompt turn-1 (sem ToolSearch
            // deferral). Sem isso, Claude verbaliza "carregando tools" e
            // gasta 1 turn extra descobrindo o catalogo.
            alwaysLoad: true,
          },
        },
        stderr: (data: string) => {
          if (data.trim()) {
            void safeEmit("stderr", { text: data.slice(0, 500) });
          }
        },
      },
    });

    for await (const msg of response) {
      // Captura session_id (vem em toda msg do SDK). 1ª turn usa este pra
      // salvar no thread; resume reusa o mesmo id (não muda).
      const maybeSession = (msg as { session_id?: string }).session_id;
      if (maybeSession && !capturedSessionId) {
        capturedSessionId = maybeSession;
      }

      // 5a. stream_event (partial) — onde mora o streaming token-a-token
      if (msg.type === "stream_event") {
        const ev = msg.event;
        if (
          ev.type === "content_block_delta" &&
          ev.delta.type === "text_delta"
        ) {
          const text = ev.delta.text;
          if (text) {
            assistantText += text;
            void safeEmit("text_delta", { text });
            void broadcast("delta", { text });
          }
        } else if (
          ev.type === "content_block_delta" &&
          ev.delta.type === "thinking_delta"
        ) {
          // Raciocínio nativo — canal separado da resposta. Broadcast como
          // "reasoning" (não "delta") pra UI renderizar no bloco "Pensando…".
          const t = (ev.delta as { thinking?: string }).thinking;
          if (t) {
            void safeEmit("thinking_delta", { text: t });
            void broadcast("reasoning", { text: t });
          }
        } else if (
          ev.type === "content_block_start" &&
          ev.content_block.type === "tool_use"
        ) {
          const tu = ev.content_block as {
            id: string;
            name: string;
            input: unknown;
          };
          void safeEmit("tool_use", {
            id: tu.id,
            tool: tu.name,
            input: tu.input,
          });
          void broadcast("tool_use", {
            id: tu.id,
            tool: tu.name,
            input: tu.input,
          });
        }
        continue;
      }

      // 5b. user (tool_result) — preview do retorno da tool
      if (msg.type === "user") {
        const blocks = (msg.message.content ?? []) as Array<{
          type?: string;
          content?: unknown;
          is_error?: boolean;
        }>;
        for (const block of blocks) {
          if (block.type === "tool_result") {
            const tr = block as {
              type: "tool_result";
              tool_use_id?: string;
              content?: unknown;
              is_error?: boolean;
            };
            const preview =
              typeof tr.content === "string"
                ? tr.content.slice(0, 1000)
                : JSON.stringify(tr.content ?? null).slice(0, 1000);
            void safeEmit("tool_result", {
              id: tr.tool_use_id,
              isError: !!tr.is_error,
              preview,
            });
            void broadcast("tool_result", {
              id: tr.tool_use_id,
              isError: !!tr.is_error,
              preview,
            });
          }
        }
        continue;
      }

      // 5c. result — final do turn com usage/cost
      if (msg.type === "result") {
        resultSubtype = msg.subtype ?? null;
        const usage = msg.usage as
          | { input_tokens?: number; output_tokens?: number }
          | undefined;
        if (usage) {
          tokensIn = usage.input_tokens ?? null;
          tokensOut = usage.output_tokens ?? null;
        }
        const costMsg = msg as { total_cost_usd?: number };
        if (typeof costMsg.total_cost_usd === "number") {
          costUsd = costMsg.total_cost_usd;
        }
        void safeEmit("claude_result", {
          subtype: resultSubtype,
          tokensIn,
          tokensOut,
          costUsd,
        });
      }
    }

    return {
      assistantText,
      tokensIn,
      tokensOut,
      costUsd,
      resultSubtype,
      capturedSessionId,
    };
  };

  try {
    // Tenta resume; se a sessão CC sumiu (pruned) ou o cwd mudou, o SDK joga
    // "No conversation found with session ID" antes de produzir texto. Nesse
    // caso limpa o ccSessionId morto e refaz fresh com o summary/history como
    // bootstrap — a thread se auto-cura em vez de travar pra sempre.
    let stream;
    try {
      stream = await streamTurn(prompt, sessionState?.ccSessionId ?? null);
    } catch (err) {
      const m = err instanceof Error ? err.message : String(err);
      const staleResume =
        !!sessionState?.ccSessionId &&
        /No conversation found with session ID/i.test(m);
      if (!staleResume) throw err;
      console.warn(
        `[exec-chat-turn] resume stale (${sessionState!.ccSessionId}); retrying fresh`,
      );
      await safeEmit("resume_stale", {
        ccSessionId: sessionState!.ccSessionId,
      });
      await clearChatThreadSession(turn.threadId);
      stream = await streamTurn(buildFreshPrompt(), null);
    }

    const {
      assistantText,
      tokensIn,
      tokensOut,
      costUsd,
      resultSubtype,
      capturedSessionId,
    } = stream;

    // 6. Finaliza turn — success path
    const hitMaxTurns = resultSubtype === "error_max_turns";
    const ok =
      !hitMaxTurns &&
      (resultSubtype === null ||
        resultSubtype === "success" ||
        resultSubtype === "end_turn");

    if (ok) {
      await completeChatTurn(chatTurnId!, {
        responseText: assistantText,
        tokensIn: tokensIn ?? undefined,
        tokensOut: tokensOut ?? undefined,
        costUsd: costUsd ?? undefined,
      });

      // Pilar 1: persiste session id capturado (1ª turn salva fresh;
      // resume re-salva o mesmo id, idempotente). Incrementa turnsSinceCompact.
      if (capturedSessionId) {
        await saveChatThreadSession({
          threadId: turn.threadId,
          ccSessionId: capturedSessionId,
          incrementTurns: true,
        });
        await safeEmit("session_saved", {
          ccSessionId: capturedSessionId,
          isResume: hasResumableSession,
        });
      }

      // Pilar 2: auto-compact silencioso. Threshold conservador (50 turns)
      // pra não disparar em conversas curtas. Compact roda DEPOIS de
      // completar este turn — UI já recebeu resposta; usuário não espera.
      const nextTurnCount = (sessionState?.turnsSinceCompact ?? 0) + 1;
      const COMPACT_THRESHOLD = Number(process.env.CHAT_COMPACT_THRESHOLD ?? "50");
      if (capturedSessionId && nextTurnCount >= COMPACT_THRESHOLD) {
        // Fire-and-forget: erro no compact não bloqueia turn já completo.
        runCompact({
          threadId: turn.threadId,
          ccSessionId: capturedSessionId,
        }).catch((e) =>
          console.warn(`[exec-chat-turn] compact failed:`, e),
        );
      }

      await safeEmit("done", { ok: true, responseText: assistantText });
      await broadcast("done", {
        ok: true,
        responseText: assistantText,
        tokensIn,
        tokensOut,
        costUsd,
      });
      await new Promise((r) => setTimeout(r, 200));
      await broadcastChannel?.unsubscribe();
      console.log(cyan(`✓ done (${assistantText.length} chars)`));
      process.exit(0);
    } else {
      const reason = hitMaxTurns ? "max_turns" : `subtype_${resultSubtype}`;
      await failChatTurn(chatTurnId!, { errorReason: reason });
      await safeEmit("done", {
        ok: false,
        reason,
        responseText: assistantText,
      });
      await broadcast("done", {
        ok: false,
        reason,
        responseText: assistantText,
      });
      await new Promise((r) => setTimeout(r, 200));
      await broadcastChannel?.unsubscribe();
      console.error(`✗ failed (${reason})`);
      process.exit(1);
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await failChatTurn(chatTurnId!, { errorReason: `sdk_error: ${message}` });
    await safeEmit("done", {
      ok: false,
      reason: "sdk_error",
      responseText: "",
    });
    await broadcast("done", {
      ok: false,
      reason: "sdk_error",
      responseText: "",
    });
    await new Promise((r) => setTimeout(r, 200));
    await broadcastChannel?.unsubscribe();
    console.error("query() failed:", err);
    process.exit(1);
  }
}

/**
 * Auto-compact (Pilar 2 — summary-only strategy).
 *
 * Roda DEPOIS de completar o turn principal — UI não bloqueia. Pede ao SDK
 * (resume na mesma session) um resumo curto da conversa, salva em
 * ChatThread.lastSummary, e zera ccSessionId — próxima turn começa fresh
 * com o summary como bootstrap (em vez do history inteiro).
 *
 * Falha silenciosa: se a query travar/falhar, thread continua com a session
 * antiga e tenta de novo no próximo turn que bater threshold.
 */
async function runCompact(args: {
  threadId: string;
  ccSessionId: string;
}): Promise<void> {
  const COMPACT_PROMPT = `Resuma nossa conversa até aqui em no máximo 2000 tokens, em português.

Inclua:
- Contexto da Design Session (projeto, objetivo, escopo discutido).
- Decisões fixadas (com IDs se houver).
- PRDs criados/atualizados (ids + status atual).
- Pendências e próximos passos.
- Preferências do usuário relevantes (tom, abordagem).

Omita:
- Saudações, agradecimentos, narrativa de processo.
- Tool calls intermediárias (preserve só o resultado final).

Devolva APENAS o resumo, sem prefácio.`;

  let summary = "";
  try {
    const response = query({
      prompt: COMPACT_PROMPT,
      options: {
        resume: args.ccSessionId,
        maxTurns: 2,
        permissionMode: "bypassPermissions",
      },
    });
    for await (const msg of response) {
      if (msg.type === "assistant") {
        const blocks = (msg.message.content ?? []) as Array<{
          type?: string;
          text?: string;
        }>;
        for (const b of blocks) {
          if (b.type === "text" && b.text) summary += b.text;
        }
      }
    }
  } catch (err) {
    console.warn(`[runCompact] query failed:`, err);
    return;
  }

  if (summary.trim().length < 50) {
    console.warn(`[runCompact] summary too short, skipping save`);
    return;
  }

  await applyChatThreadCompact({
    threadId: args.threadId,
    summary: summary.trim(),
  });
  console.log(`[runCompact] thread=${args.threadId} summary=${summary.length}c`);
}

const DEFAULT_SYSTEM_PROMPT = `Você é o Vitor, agente de Discovery do Volund.
Ajude o PM a estruturar uma Design Session em uma conversa natural.
Seja breve, direto e prático. Use português.

Nota: ferramentas (MCP) ainda não estão conectadas nesta fase. Por enquanto,
responda apenas com texto e ajude o user a pensar.`;

main().catch(async (err) => {
  console.error("exec-chat-turn fatal error:", err);
  try {
    await failChatTurn(chatTurnId!, { errorReason: `fatal: ${err.message}` });
  } catch {
    /* ignore */
  }
  process.exit(1);
});
