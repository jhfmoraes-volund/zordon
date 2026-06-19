"use client";

import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import { useState, useEffect, useCallback, useMemo } from "react";
import { useDesignSession } from "@/contexts/design-session-context";
import { useChatPlanMode } from "./use-chat-plan-mode";

/**
 * Chat hook for the design session AI assistant.
 * Wraps AI SDK v6's useChat with session context and thread management.
 */
export function useDesignSessionChat() {
  const ctx = useDesignSession();
  const [threadId, setThreadId] = useState<string | null>(null);
  const [isOpen, setIsOpen] = useState(false);
  const [input, setInput] = useState("");
  // True quando o turno caiu no fallback OpenRouter (daemon offline). Cada
  // resposta POST re-seta o valor a partir do header X-Mode-Fallback.
  const [isFallback, setIsFallback] = useState(false);
  const { planMode, setPlanMode } = useChatPlanMode("vitor");

  const transport = useMemo(
    () =>
      new DefaultChatTransport({
        api: `/api/design-sessions/${ctx.sessionId}/chat`,
        body: {
          sessionId: ctx.sessionId,
          currentStepKey: ctx.currentStepKey,
          threadId,
          planMode,
        },
        fetch: async (input, init) => {
          const res = await fetch(input as RequestInfo, init);
          setIsFallback(res.headers.get("X-Mode-Fallback") === "true");
          return res;
        },
        // resumeStream() reconecta a um turn em vôo (canal web). O turn é
        // resolvido server-side a partir do thread — sem id do cliente.
        prepareReconnectToStreamRequest: () => ({
          api: `/api/design-sessions/${ctx.sessionId}/chat/resume?channel=web`,
        }),
      }),
    [ctx.sessionId, ctx.currentStepKey, threadId, planMode]
  );

  const chat = useChat({
    transport,
    // After AI responds (may have used tools), per-step hooks own their own
    // revalidation. Nothing to refresh globally here.
  });

  // Load existing chat history on mount
  useEffect(() => {
    fetch(`/api/design-sessions/${ctx.sessionId}/chat`)
      .then((r) => r.json())
      .then((data) => {
        if (data.threadId) {
          setThreadId(data.threadId);
        }
        if (data.messages?.length) {
          chat.setMessages(
            data.messages
              .filter((m: { role: string }) => m.role === "user" || m.role === "assistant")
              .map((m: { id: string; role: string; content: string }) => ({
                id: m.id,
                role: m.role as "user" | "assistant",
                content: m.content,
                parts: [{ type: "text" as const, text: m.content }],
              }))
          );
        }
        // Geração em andamento no background → reconecta ao stream pra a UI
        // voltar a "pensar" de onde parou (replay + tail do ChatTurnEvent).
        if (data.activeTurn) {
          void chat.resumeStream();
        }
      })
      .catch(() => {});
    // Carrega histórico uma vez por sessão; `chat` é estável o suficiente e
    // adicioná-lo re-dispararia o fetch a cada render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ctx.sessionId]);

  const sendMessage = useCallback(
    (text: string) => {
      if (!text.trim()) return;
      setInput("");
      chat.sendMessage({ text });
    },
    [chat]
  );

  const toggle = useCallback(() => setIsOpen((prev) => !prev), []);
  const open = useCallback(() => setIsOpen(true), []);
  const close = useCallback(() => setIsOpen(false), []);

  return {
    messages: chat.messages,
    status: chat.status,
    error: chat.error,
    stop: chat.stop,
    sendMessage,
    input,
    setInput,
    threadId,
    isFallback,
    isOpen,
    toggle,
    open,
    close,
    planMode,
    setPlanMode,
  };
}
