import { randomUUID } from "node:crypto";
import {
  createUIMessageStream,
  createUIMessageStreamResponse,
  type UIMessageStreamWriter,
} from "ai";
import { db } from "@/lib/db";
import { createChatTurn, enqueueChatJob } from "@/lib/dal/chat-turn";

/**
 * SSE proxy compartilhado pelos endpoints de chat (Vitor DS, Vitoria PM Review,
 * Vitoria Planning, etc.) quando AgentMode='claude-daemon'.
 *
 * Mecânica:
 *   1. INSERT ChatTurn (status=queued)
 *   2. SUBSCRIBE broadcast `chat-turn-{id}` (await SUBSCRIBED) — antes do job
 *   3. ENQUEUE ForgeJob(kind=chat) — daemon pega
 *   4. Forward deltas do broadcast pro writer (text-delta chunks)
 *   5. broadcast 'done' → text-end + finish + close
 *
 * Cliente: usa useChat AI SDK normal. Endpoint retorna SSE UIMessage stream.
 * Mesma UX do path openrouter — branch fica invisível pro front.
 */
export function streamViaClaudeDaemon(args: {
  threadId: string;
  userMessageId: string;
  agentSlug: string;
  ownerId: string;
}): Promise<Response> {
  return (async () => {
    const chatTurnId = await createChatTurn({
      threadId: args.threadId,
      userMessageId: args.userMessageId,
      agentSlug: args.agentSlug,
    });

    const stream = createUIMessageStream({
      execute: async ({ writer }: { writer: UIMessageStreamWriter }) => {
        const messageId = randomUUID();
        writer.write({ type: "start", messageId });
        writer.write({ type: "text-start", id: messageId });

        let assistantText = "";
        let reasoningId: string | null = null;
        let finished = false;
        let resolveDone: (() => void) | null = null;
        const donePromise = new Promise<void>((r) => {
          resolveDone = r;
        });

        const channelClient = db();
        const channel = channelClient.channel(`chat-turn-${chatTurnId}`, {
          config: { broadcast: { self: true } },
        });

        channel
          .on("broadcast", { event: "delta" }, ({ payload }) => {
            const text = (payload as { text?: string })?.text ?? "";
            if (!text || finished) return;
            assistantText += text;
            writer.write({ type: "text-delta", delta: text, id: messageId });
          })
          .on("broadcast", { event: "reasoning" }, ({ payload }) => {
            const text = (payload as { text?: string })?.text ?? "";
            if (!text || finished) return;
            // Raciocínio nativo (thinking) — parte separada da resposta. Abre
            // o bloco de reasoning lazy no 1º delta; a UI renderiza num
            // disclosure colapsável "Pensando…".
            if (!reasoningId) {
              reasoningId = randomUUID();
              writer.write({ type: "reasoning-start", id: reasoningId });
            }
            writer.write({ type: "reasoning-delta", delta: text, id: reasoningId });
          })
          .on("broadcast", { event: "tool_use" }, ({ payload }) => {
            if (finished) return;
            const p = payload as {
              id?: string;
              tool?: string;
              input?: unknown;
            };
            if (!p.id || !p.tool) return;
            // Emit AI SDK tool-input-available UIMessage part — useChat
            // renderiza chip "tool: <name>" automaticamente.
            writer.write({
              type: "tool-input-available",
              toolCallId: p.id,
              toolName: p.tool,
              input: p.input ?? {},
            });
          })
          .on("broadcast", { event: "tool_result" }, ({ payload }) => {
            if (finished) return;
            const p = payload as {
              id?: string;
              isError?: boolean;
              preview?: string;
            };
            if (!p.id) return;
            if (p.isError) {
              writer.write({
                type: "tool-output-error",
                toolCallId: p.id,
                errorText: p.preview ?? "tool error",
              });
            } else {
              writer.write({
                type: "tool-output-available",
                toolCallId: p.id,
                output: p.preview ?? "",
              });
            }
          })
          .on("broadcast", { event: "done" }, ({ payload }) => {
            if (finished) return;
            finished = true;
            const fallback =
              (payload as { responseText?: string })?.responseText ?? "";
            if (fallback && fallback.length > assistantText.length) {
              writer.write({
                type: "text-delta",
                delta: fallback.slice(assistantText.length),
                id: messageId,
              });
            }
            resolveDone?.();
          });

        await new Promise<void>((resolve, reject) => {
          const t = setTimeout(
            () => reject(new Error("broadcast subscribe timeout")),
            5000,
          );
          channel.subscribe((status) => {
            if (status === "SUBSCRIBED") {
              clearTimeout(t);
              resolve();
            } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
              clearTimeout(t);
              reject(new Error(`subscribe failed: ${status}`));
            }
          });
        });

        await enqueueChatJob({
          chatTurnId,
          agentSlug: args.agentSlug,
          ownerId: args.ownerId,
        });

        const TIMEOUT_MS = 5 * 60_000;
        await Promise.race([
          donePromise,
          new Promise<void>((res) => setTimeout(res, TIMEOUT_MS)),
        ]);

        if (reasoningId) {
          writer.write({ type: "reasoning-end", id: reasoningId });
        }
        writer.write({ type: "text-end", id: messageId });
        writer.write({ type: "finish" });
        await channel.unsubscribe();
      },
      onError: (err) => {
        console.error("[sse-chat-proxy] error:", err);
        return err instanceof Error ? err.message : String(err);
      },
    });

    return createUIMessageStreamResponse({ stream });
  })();
}

/**
 * Verifica se há daemon ativo (heartbeat <60s). Usado pelo fallback automático
 * dos endpoints — se daemon offline, cai pra openrouter pra UX não travar.
 */
export async function isDaemonOnline(): Promise<boolean> {
  const cutoff = new Date(Date.now() - 60_000).toISOString();
  const { count } = await db()
    .from("ForgeDaemon")
    .select("daemonId", { count: "exact", head: true })
    .gte("lastHeartbeatAt", cutoff);
  return (count ?? 0) > 0;
}
