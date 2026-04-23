"use client";

import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import { useState, useEffect, useCallback, useMemo } from "react";
import { useDesignSession } from "@/contexts/design-session-context";

/**
 * Chat hook for the design session AI assistant.
 * Wraps AI SDK v6's useChat with session context and thread management.
 */
export function useDesignSessionChat() {
  const ctx = useDesignSession();
  const [threadId, setThreadId] = useState<string | null>(null);
  const [isOpen, setIsOpen] = useState(false);
  const [input, setInput] = useState("");

  const transport = useMemo(
    () =>
      new DefaultChatTransport({
        api: `/api/design-sessions/${ctx.sessionId}/chat`,
        body: {
          sessionId: ctx.sessionId,
          currentStepKey: ctx.currentStepKey,
          threadId,
        },
      }),
    [ctx.sessionId, ctx.currentStepKey, threadId]
  );

  const chat = useChat({
    transport,
    onFinish: () => {
      // After AI responds (may have used tools), refresh step data
      ctx.refreshStepData();
    },
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
      })
      .catch(() => {});
  }, [ctx.sessionId]);

  const sendMessage = useCallback(
    (text: string) => {
      if (!text.trim()) return;
      setInput("");
      chat.sendMessage({ text });
    },
    [chat.sendMessage]
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
    isOpen,
    toggle,
    open,
    close,
  };
}
