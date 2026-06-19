import { randomUUID } from "node:crypto";
import type { UIMessageStreamWriter } from "ai";

/**
 * Montagem de UMA mensagem-assistente a partir de um fluxo de eventos.
 *
 * Compartilhado por dois caminhos que produzem o MESMO UIMessage stream:
 *   - sse-chat-proxy.ts  → turn fresco, eventos vêm do broadcast Realtime ao vivo
 *   - resume-chat-stream.ts → turn em vôo/concluído, eventos vêm do replay de
 *                             ChatTurnEvent persistido (seq-ordered)
 *
 * O daemon (exec-chat-turn.ts) emite payloads IDÊNTICOS pros dois lados
 * (`safeEmit` durável + `broadcast` efêmero); só os nomes de evento divergem
 * (`delta`/`reasoning` no broadcast vs `text_delta`/`thinking_delta` no
 * ChatTurnEvent). Por isso a normalização vive aqui, num lugar só — pra os dois
 * renderizadores nunca divergirem.
 */
export type ChatStreamState = {
  messageId: string;
  reasoningId: string | null;
  assistantText: string;
  finished: boolean;
  /** toolCallIds que já tiveram `tool-input-available` emitido. O AI SDK exige a
   *  tool part ABERTA antes de qualquer output; sem isto, um `tool_result` cujo
   *  `tool_use` foi dropado (broadcast Realtime é best-effort) quebra a UI com
   *  "No tool invocation found for tool call ID". */
  openedTools: Set<string>;
};

export function newChatStreamState(): ChatStreamState {
  return {
    messageId: randomUUID(),
    reasoningId: null,
    assistantText: "",
    finished: false,
    openedTools: new Set(),
  };
}

/** Evento normalizado — denominador comum entre broadcast e ChatTurnEvent. */
export type ChatStreamEvent =
  | { type: "text"; text: string }
  | { type: "reasoning"; text: string }
  | { type: "tool_use"; id: string; tool: string; input: unknown }
  | { type: "tool_result"; id: string; isError: boolean; preview: string }
  | { type: "done"; responseText: string };

function asRecord(payload: unknown): Record<string, unknown> {
  return (payload ?? {}) as Record<string, unknown>;
}

function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}

function toToolUse(p: Record<string, unknown>): ChatStreamEvent | null {
  if (typeof p.id !== "string" || typeof p.tool !== "string") return null;
  return { type: "tool_use", id: p.id, tool: p.tool, input: p.input ?? {} };
}

function toToolResult(p: Record<string, unknown>): ChatStreamEvent | null {
  if (typeof p.id !== "string") return null;
  return { type: "tool_result", id: p.id, isError: !!p.isError, preview: str(p.preview) };
}

/** Mapeia (event, payload) do broadcast Realtime → ChatStreamEvent. */
export function fromBroadcast(event: string, payload: unknown): ChatStreamEvent | null {
  const p = asRecord(payload);
  switch (event) {
    case "delta": {
      const text = str(p.text);
      return text ? { type: "text", text } : null;
    }
    case "reasoning": {
      const text = str(p.text);
      return text ? { type: "reasoning", text } : null;
    }
    case "tool_use":
      return toToolUse(p);
    case "tool_result":
      return toToolResult(p);
    case "done":
      return { type: "done", responseText: str(p.responseText) };
    default:
      return null;
  }
}

/**
 * Mapeia (kind, payload) do ChatTurnEvent persistido → ChatStreamEvent.
 * Kinds ignorados (não viram parte da mensagem): started, stderr,
 * prepare_turn_*, claude_result, session_saved, resume_stale.
 */
export function fromTurnEvent(kind: string, payload: unknown): ChatStreamEvent | null {
  const p = asRecord(payload);
  switch (kind) {
    case "text_delta": {
      const text = str(p.text);
      return text ? { type: "text", text } : null;
    }
    case "thinking_delta": {
      const text = str(p.text);
      return text ? { type: "reasoning", text } : null;
    }
    case "tool_use":
      return toToolUse(p);
    case "tool_result":
      return toToolResult(p);
    case "done":
      return { type: "done", responseText: str(p.responseText) };
    default:
      return null;
  }
}

/**
 * Aplica 1 evento normalizado no writer, mutando o estado. Idempotente após
 * `finished`. A moldura (start / text-start no início; reasoning-end / text-end
 * / finish no fim) fica a cargo do chamador — esta função só trata o miolo.
 */
export function applyChatStreamEvent(
  writer: UIMessageStreamWriter,
  state: ChatStreamState,
  ev: ChatStreamEvent,
): void {
  if (state.finished) return;
  switch (ev.type) {
    case "text":
      state.assistantText += ev.text;
      writer.write({ type: "text-delta", delta: ev.text, id: state.messageId });
      break;
    case "reasoning":
      // Abre o bloco de reasoning lazy no 1º delta; a UI renderiza num
      // disclosure colapsável "Pensando…".
      if (!state.reasoningId) {
        state.reasoningId = randomUUID();
        writer.write({ type: "reasoning-start", id: state.reasoningId });
      }
      writer.write({ type: "reasoning-delta", delta: ev.text, id: state.reasoningId });
      break;
    case "tool_use":
      writer.write({
        type: "tool-input-available",
        toolCallId: ev.id,
        toolName: ev.tool,
        input: ev.input,
      });
      state.openedTools.add(ev.id);
      break;
    case "tool_result":
      // Self-heal: se o `tool_use` não chegou (broadcast dropado / fora de
      // ordem), abre uma tool part sintética antes do output — senão o AI SDK
      // joga "No tool invocation found". Nome real perde-se (tool_result não o
      // carrega); a chip fica genérica, mas o turn não quebra.
      if (!state.openedTools.has(ev.id)) {
        writer.write({
          type: "tool-input-available",
          toolCallId: ev.id,
          toolName: "tool",
          input: {},
        });
        state.openedTools.add(ev.id);
      }
      if (ev.isError) {
        writer.write({
          type: "tool-output-error",
          toolCallId: ev.id,
          errorText: ev.preview || "tool error",
        });
      } else {
        writer.write({
          type: "tool-output-available",
          toolCallId: ev.id,
          output: ev.preview,
        });
      }
      break;
    case "done":
      state.finished = true;
      // `responseText` é o texto completo capturado pelo daemon; se vier maior
      // que o acumulado por deltas (deltas perdidos), emite a cauda faltante.
      if (ev.responseText && ev.responseText.length > state.assistantText.length) {
        writer.write({
          type: "text-delta",
          delta: ev.responseText.slice(state.assistantText.length),
          id: state.messageId,
        });
        state.assistantText = ev.responseText;
      }
      break;
  }
}

/** Escreve a moldura de abertura (start + text-start). */
export function openChatStream(writer: UIMessageStreamWriter, state: ChatStreamState): void {
  writer.write({ type: "start", messageId: state.messageId });
  writer.write({ type: "text-start", id: state.messageId });
}

/** Escreve a moldura de fechamento (reasoning-end? + text-end + finish). */
export function closeChatStream(writer: UIMessageStreamWriter, state: ChatStreamState): void {
  if (state.reasoningId) {
    writer.write({ type: "reasoning-end", id: state.reasoningId });
  }
  writer.write({ type: "text-end", id: state.messageId });
  writer.write({ type: "finish" });
}
