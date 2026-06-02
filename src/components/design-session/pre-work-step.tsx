"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import type { UIMessage } from "ai";
import {
  ConversationFab,
  ConversationPanel,
} from "@/components/ui/conversation";
import { readPlanMode, useChatPlanMode } from "@/hooks/use-chat-plan-mode";
import { useIsMobile } from "@/hooks/use-mobile";
import { InsumosButton } from "@/components/agent/context-import";
import { DesignSessionContextSheet } from "./design-session-context-sheet";
import { StepActions } from "./ribbon";

const WELCOME_TEXT =
  "Olá! Sou o Vitor, seu assistente de design de produto. Me conte sobre o projeto — descreva em texto livre ou anexe documentos pelo botão Insumos.";

/**
 * Pre-work step do Vitor. Usa useChat (AI SDK) — funciona transparente em
 * ambos os modos (openrouter ou claude-daemon) porque o endpoint server-side
 * abstrai a diferença via SSE proxy (createUIMessageStreamResponse).
 */
export function PreWorkStep({
  sessionId,
  projectId,
}: {
  sessionId: string;
  projectId: string;
}) {
  const [inputText, setInputText] = useState("");
  const [threadId, setThreadId] = useState<string | null>(null);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [insumosOpen, setInsumosOpen] = useState(false);
  const [insumosCount, setInsumosCount] = useState(0);

  const threadIdRef = useRef<string | null>(threadId);
  useEffect(() => {
    threadIdRef.current = threadId;
  }, [threadId]);

  const isMobile = useIsMobile();
  const { planMode, setPlanMode } = useChatPlanMode("vitor");

  const stepActionNode = (
    <InsumosButton
      count={insumosCount}
      onClick={() => setInsumosOpen(true)}
      variant="outline"
      className="h-7 text-xs"
    />
  );

  const transport = useMemo(
    () =>
      new DefaultChatTransport({
        api: `/api/design-sessions/${sessionId}/chat`,
        body: {
          sessionId,
          currentStepKey: "pre_work",
          get threadId() {
            return threadIdRef.current;
          },
          get planMode() {
            return readPlanMode("vitor");
          },
        },
      }),
    [sessionId],
  );

  const initialMsg = useMemo<UIMessage>(
    () => ({
      id: "initial",
      role: "assistant" as const,
      parts: [{ type: "text" as const, text: WELCOME_TEXT }],
    }) as UIMessage,
    [],
  );

  const { messages, status, sendMessage, stop, setMessages } = useChat({
    transport,
    messages: [initialMsg],
  });

  const isStreaming = status === "streaming" || status === "submitted";

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/design-sessions/${sessionId}/chat?channel=web&limit=100`)
      .then((r) => {
        if (!r.ok) throw new Error(`Chat history fetch failed: ${r.status}`);
        return r.json();
      })
      .then((result) => {
        if (cancelled) return;
        if (result.threadId) setThreadId(result.threadId);
        if (result.messages?.length) {
          const restored = result.messages
            .filter(
              (m: { role: string }) =>
                m.role === "user" || m.role === "assistant",
            )
            .map((m: { id: string; role: string; content: string }) => ({
              id: m.id,
              role: m.role as "user" | "assistant",
              content: m.content,
              parts: [{ type: "text" as const, text: m.content }],
            }));
          setMessages([initialMsg, ...restored]);
        }
      })
      .catch((err) => {
        console.error("[PreWorkStep] Failed to load chat history:", err);
      });
    return () => {
      cancelled = true;
    };
  }, [sessionId, setMessages, initialMsg]);

  const handleSend = useCallback(() => {
    const text = inputText.trim();
    if (!text || isStreaming) return;
    setInputText("");
    sendMessage({ text });
  }, [inputText, isStreaming, sendMessage]);

  const sharedPanelProps = {
    agent: "vitor" as const,
    messages,
    status,
    input: inputText,
    onInputChange: setInputText,
    onSubmit: handleSend,
    onStop: stop,
    planMode,
    onPlanModeChange: setPlanMode,
    placeholder: "Descreva o projeto ou cole texto…",
    composerSubmitDisabled: !inputText.trim(),
  };

  if (isMobile) {
    return (
      <>
        <StepActions>{stepActionNode}</StepActions>
        <ConversationFab
          agent="vitor"
          isOpen={mobileOpen}
          isStreaming={isStreaming}
          onClick={() => setMobileOpen(true)}
        />
        <ConversationPanel
          {...sharedPanelProps}
          variant="mobile"
          isOpen={mobileOpen}
          onOpenChange={setMobileOpen}
          onClose={() => setMobileOpen(false)}
        />
        <DesignSessionContextSheet
          sessionId={sessionId}
          projectId={projectId}
          open={insumosOpen}
          onOpenChange={setInsumosOpen}
          ritualLabel="DS"
          onCountChange={setInsumosCount}
        />
      </>
    );
  }

  return (
    <div className="mx-auto flex h-[calc(100vh-200px)] max-w-2xl flex-col">
      <StepActions>{stepActionNode}</StepActions>
      <div className="surface relative flex flex-1 flex-col overflow-hidden">
        <ConversationPanel {...sharedPanelProps} variant="desktop" />
      </div>

      <DesignSessionContextSheet
        sessionId={sessionId}
        projectId={projectId}
        open={insumosOpen}
        onOpenChange={setInsumosOpen}
        ritualLabel="DS"
        onCountChange={setInsumosCount}
      />
    </div>
  );
}
