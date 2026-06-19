import {
  createUIMessageStream,
  createUIMessageStreamResponse,
  type UIMessageStreamWriter,
} from "ai";
import { db } from "@/lib/db";
import { createChatTurn, enqueueChatJob } from "@/lib/dal/chat-turn";
import {
  applyChatStreamEvent,
  closeChatStream,
  fromBroadcast,
  newChatStreamState,
  openChatStream,
} from "@/lib/agent/chat-ui-stream";
import type { Json } from "@/lib/supabase/database.types";

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
  /** currentPath do cliente — persistido no ChatTurn pra route-scoping do Alpha
   *  (Fase 2). Opcional; surfaces que resolvem projeto pela entidade não passam. */
  routePath?: string | null;
  /** Params do Ritual Playbook (audienceFloor + emphasisSections) — o caller
   *  (ex: PM Review chat) resolve via getEffectivePlaybook + derivePromptParams. */
  turnParams?: Json | null;
}): Promise<Response> {
  return (async () => {
    const chatTurnId = await createChatTurn({
      threadId: args.threadId,
      userMessageId: args.userMessageId,
      agentSlug: args.agentSlug,
      routePath: args.routePath ?? null,
      turnParams: args.turnParams ?? null,
    });

    const stream = createUIMessageStream({
      execute: async ({ writer }: { writer: UIMessageStreamWriter }) => {
        const state = newChatStreamState();
        openChatStream(writer, state);

        let resolveDone: (() => void) | null = null;
        const donePromise = new Promise<void>((r) => {
          resolveDone = r;
        });

        const channelClient = db();
        const channel = channelClient.channel(`chat-turn-${chatTurnId}`, {
          config: { broadcast: { self: true } },
        });

        // Cada evento do broadcast é normalizado e aplicado pelo mesmo mapper
        // do resume — UIMessage parts (text-delta, reasoning, tool chips, etc.).
        const handle =
          (event: string) =>
          ({ payload }: { payload: unknown }) => {
            const ev = fromBroadcast(event, payload);
            if (!ev) return;
            applyChatStreamEvent(writer, state, ev);
            if (ev.type === "done") resolveDone?.();
          };

        channel
          .on("broadcast", { event: "delta" }, handle("delta"))
          .on("broadcast", { event: "reasoning" }, handle("reasoning"))
          .on("broadcast", { event: "tool_use" }, handle("tool_use"))
          .on("broadcast", { event: "tool_result" }, handle("tool_result"))
          .on("broadcast", { event: "done" }, handle("done"));

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
          threadId: args.threadId,
        });

        const TIMEOUT_MS = 5 * 60_000;
        await Promise.race([
          donePromise,
          new Promise<void>((res) => setTimeout(res, TIMEOUT_MS)),
        ]);

        closeChatStream(writer, state);
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
