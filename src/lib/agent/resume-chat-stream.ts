import { createUIMessageStream, createUIMessageStreamResponse } from "ai";
import {
  getChatTurn,
  getChatTurnEventsAfter,
} from "@/lib/dal/chat-turn";
import {
  applyChatStreamEvent,
  closeChatStream,
  fromTurnEvent,
  newChatStreamState,
  openChatStream,
} from "@/lib/agent/chat-ui-stream";

const POLL_MS = 500;
const TIMEOUT_MS = 5 * 60_000;
const TERMINAL = new Set(["done", "error", "aborted"]);

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * Reconecta o cliente a um ChatTurn em vôo (ou recém-concluído), re-emitindo o
 * MESMO UIMessage stream que o turn fresco produziria.
 *
 * Diferente do SSE proxy (que escuta o broadcast Realtime ao vivo), o resume lê
 * o log durável `ChatTurnEvent`:
 *   1. replay de tudo o que já streamou (resposta parcial + reasoning + tools);
 *   2. se o turn ainda roda, faz tail dos eventos novos (poll por seq) até `done`
 *      ou status terminal.
 *
 * Como o log é append-only e seq é monotônico, o tail é exactly-once — sem o
 * problema de dedup que existiria ao misturar replay + broadcast ao vivo. Se o
 * turn já terminou, a primeira iteração drena todos os eventos e fecha na hora.
 *
 * Consumido via `useChat().resumeStream()` → transport.reconnectToStream (GET).
 */
export function streamResumeChatTurn(turnId: string): Response {
  const stream = createUIMessageStream({
    execute: async ({ writer }) => {
      const state = newChatStreamState();
      openChatStream(writer, state);

      let lastSeq = 0;
      const deadline = Date.now() + TIMEOUT_MS;

      const drain = async (): Promise<void> => {
        const events = await getChatTurnEventsAfter(turnId, lastSeq);
        for (const e of events) {
          lastSeq = e.seq;
          const ev = fromTurnEvent(e.kind, e.payload);
          if (ev) applyChatStreamEvent(writer, state, ev);
          if (state.finished) break;
        }
      };

      while (!state.finished && Date.now() < deadline) {
        await drain();
        if (state.finished) break;

        // Sem evento `done` ainda — checa se o turn morreu (error/aborted) ou
        // concluiu sem emitir done. Em terminal, drena a cauda e fecha.
        const turn = await getChatTurn(turnId);
        if (!turn || TERMINAL.has(turn.status)) {
          await drain();
          break;
        }
        await sleep(POLL_MS);
      }

      closeChatStream(writer, state);
    },
    onError: (err) => {
      console.error("[resume-chat-stream] error:", err);
      return err instanceof Error ? err.message : String(err);
    },
  });

  return createUIMessageStreamResponse({ stream });
}
