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
  completeChatTurn,
  failChatTurn,
  markChatTurnRunning,
  setChatTurnSystemPrompt,
} from "../../src/lib/dal/chat-turn";

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
    .select("id, threadId, agentSlug, status, systemPrompt")
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
    .select("role, content, createdAt")
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

  // 4. Hidrata systemPrompt via prepare-turn endpoint (assembleia contexto da
  // DS atual — current step, decisões, open questions, transcripts, etc.)
  const prepareUrl = `${ZORDON_URL}/api/agents/${turn.agentSlug}/prepare-turn`;
  let systemPrompt = DEFAULT_SYSTEM_PROMPT;
  let preparedHistory: Array<{ role: "user" | "assistant"; content: string }> =
    (history ?? [])
      .filter((m) => m.role === "user" || m.role === "assistant")
      .map((m) => ({
        role: m.role as "user" | "assistant",
        content: m.content,
      }));
  try {
    const res = await fetch(prepareUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chatTurnId }),
    });
    if (res.ok) {
      const data = (await res.json()) as {
        systemPrompt?: string;
        history?: Array<{ role: "user" | "assistant"; content: string }>;
      };
      if (data.systemPrompt && data.systemPrompt.length > 0) {
        systemPrompt = data.systemPrompt;
        await setChatTurnSystemPrompt(chatTurnId!, systemPrompt);
      }
      if (Array.isArray(data.history) && data.history.length > 0) {
        preparedHistory = data.history;
      }
      await safeEmit("prepare_turn_ok", {
        systemPromptLen: systemPrompt.length,
        historyLen: preparedHistory.length,
      });
    } else {
      await safeEmit("prepare_turn_fallback", {
        status: res.status,
        reason: "prepare-turn endpoint returned non-OK; using DEFAULT prompt",
      });
    }
  } catch (err) {
    await safeEmit("prepare_turn_fallback", {
      reason: `network: ${(err as Error).message}`,
    });
  }

  const historyText = preparedHistory
    .slice(-10)
    .map((m) => `[${m.role}] ${m.content}`)
    .join("\n\n");

  const prompt = `${systemPrompt}\n\n---\nHistórico:\n${historyText}\n\n---\nResponda agora a última mensagem do user de forma natural, em Português. Use as MCP tools (zordon namespace) quando precisar ler/escrever entidades da DS.`;

  // 5. Roda Claude via SDK programático (não spawn da CLI).
  //    SDK usa MESMA binary, MESMA auth (~/.claude/), MESMA subscription.
  //    Diferença chave: `includePartialMessages: true` libera streaming
  //    token-a-token (eventos content_block_delta), enquanto `claude -p`
  //    buffera mensagens completas.
  const repoRoot = process.cwd();
  const mcpServerPath = resolve(repoRoot, "scripts/daemon/mcp-server.ts");
  const maxTurns = Number(process.env.CHAT_MAX_TURNS ?? "80");

  console.log(dim(`  SDK query (max_turns=${maxTurns}, mcp=zordon stdio)`));

  let assistantText = "";
  let tokensIn: number | null = null;
  let tokensOut: number | null = null;
  let costUsd: number | null = null;
  let resultSubtype: string | null = null;

  try {
    const response = query({
      prompt,
      options: {
        includePartialMessages: true,
        maxTurns,
        mcpServers: {
          zordon: {
            type: "stdio",
            command: "npx",
            args: ["tsx", mcpServerPath],
            env: {
              AGENT_SLUG: turn.agentSlug,
              CHAT_TURN_ID: chatTurnId!,
            },
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
          ev.type === "content_block_start" &&
          ev.content_block.type === "tool_use"
        ) {
          void safeEmit("tool_use", {
            tool: ev.content_block.name,
            input: ev.content_block.input,
          });
          void broadcast("tool_use", { tool: ev.content_block.name });
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
            void safeEmit("tool_result", {
              isError: !!block.is_error,
              preview:
                typeof block.content === "string"
                  ? block.content.slice(0, 300)
                  : "<structured>",
            });
            void broadcast("tool_result", { isError: !!block.is_error });
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
      responseText: assistantText,
    });
    await broadcast("done", {
      ok: false,
      reason: "sdk_error",
      responseText: assistantText,
    });
    await new Promise((r) => setTimeout(r, 200));
    await broadcastChannel?.unsubscribe();
    console.error("query() failed:", err);
    process.exit(1);
  }
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
