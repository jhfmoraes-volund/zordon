"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import type { UIMessage } from "ai";
import { Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  ConversationFab,
  ConversationPanel,
} from "@/components/ui/conversation";
import { readPlanMode, useChatPlanMode } from "@/hooks/use-chat-plan-mode";
import { useIsMobile } from "@/hooks/use-mobile";

const WELCOME_TEXT =
  "Oi! Sou o Vitor. Estudei o briefing desta session e vou te ajudar a transformar tudo em backlog acionável.\n\nMeu fluxo tem 4 etapas, sempre conversadas antes de eu mexer em nada:\n\n1. **Mapear módulos** — leio o brainstorm, escopo e personas, e proponho como dividir o produto em módulos coesos. Você valida.\n2. **Gerar user stories** — pra cada módulo, escrevo as stories considerando todas as personas que tocam aquele fluxo, ancoradas nos cards de brainstorm que você já mapeou.\n3. **Refinar uma story** — quando você apontar uma, defino persona + critérios de aceite verificáveis.\n4. **Decompor em tasks** — quebro a story refinada em tasks técnicas autossuficientes pro time executar.\n\nPra começar, me diga algo como **\"liste os módulos que você identifica no brainstorm\"** ou **\"como você divide esse produto em módulos?\"** — e eu sigo daí.";

export function BriefingTaskChat({
  sessionId,
  onTasksChanged,
  onSendReady,
}: {
  sessionId: string;
  onTasksChanged?: () => void;
  /** Hands the parent a `sendMessage(text)` function once the chat is mounted.
   *  Used by sibling tree to drive the chat from action buttons (Detalhar /
   *  Gerar tasks) without duplicating the streaming/transport stack. */
  onSendReady?: (sendMessage: (text: string) => void) => void;
}) {
  const [threadId, setThreadId] = useState<string | null>(null);
  const [existingTaskCount, setExistingTaskCount] = useState<number | null>(null);
  const [hasMoreHistory, setHasMoreHistory] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [input, setInput] = useState("");
  const [mobileOpen, setMobileOpen] = useState(false);
  const isMobile = useIsMobile();
  const oldestLoadedAtRef = useRef<string | null>(null);
  const threadIdRef = useRef<string | null>(null);
  threadIdRef.current = threadId;

  const { planMode, setPlanMode } = useChatPlanMode("vitor");

  // Canal "web" unificado: mesmo thread dos outros steps. Vitor herda contexto.
  // Visual fica limpo na entrada do briefing porque o GET filtra por
  // `allFromBriefing=1` (só mensagens >= DesignSessionStepData.briefing.firstMessageAt).
  // Histórico anterior é acessível via botão "Carregar mensagens anteriores".
  const transport = useMemo(
    () =>
      new DefaultChatTransport({
        api: `/api/design-sessions/${sessionId}/chat`,
        body: {
          sessionId,
          currentStepKey: "briefing",
          channel: "web",
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

  const initialMsg: UIMessage = {
    id: "briefing-welcome",
    role: "assistant",
    parts: [{ type: "text", text: WELCOME_TEXT }],
  };

  const { messages, status, sendMessage, stop, setMessages } = useChat({
    transport,
    messages: [initialMsg],
    onFinish: () => {
      refreshTaskCount();
    },
  });

  useEffect(() => {
    if (!onSendReady) return;
    onSendReady((text: string) => {
      sendMessage({ text });
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onSendReady]);

  const isStreaming = status === "streaming" || status === "submitted";

  const refreshTaskCount = async () => {
    try {
      const r = await fetch(`/api/design-sessions/${sessionId}/tasks?countOnly=1`);
      const j = await r.json();
      setExistingTaskCount(j.count ?? 0);
      onTasksChanged?.();
    } catch {
      // ignore
    }
  };

  // Mount: load only briefing-era messages.
  useEffect(() => {
    let cancelled = false;
    fetch(
      `/api/design-sessions/${sessionId}/chat?channel=web&allFromBriefing=1&limit=30`,
    )
      .then((r) => (r.ok ? r.json() : { threadId: null, messages: [], hasMore: false }))
      .then((result) => {
        if (cancelled) return;
        if (result.threadId) setThreadId(result.threadId);
        const briefingMessages: Array<{
          id: string;
          role: string;
          content: string;
          createdAt?: string;
        }> = result.messages ?? [];
        if (briefingMessages.length > 0) {
          const restored = briefingMessages
            .filter((m) => m.role === "user" || m.role === "assistant")
            .map((m) => ({
              id: m.id,
              role: m.role as "user" | "assistant",
              content: m.content,
              parts: [{ type: "text" as const, text: m.content }],
            }));
          setMessages([initialMsg, ...restored]);
          oldestLoadedAtRef.current = briefingMessages[0]?.createdAt ?? null;
          setHasMoreHistory(true);
        } else {
          setHasMoreHistory(result.briefingPending === true);
        }
      })
      .catch(() => {});
    refreshTaskCount();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId]);

  const loadMoreHistory = async () => {
    if (loadingMore) return;
    setLoadingMore(true);
    try {
      const params = new URLSearchParams({ channel: "web", limit: "30" });
      if (oldestLoadedAtRef.current) params.set("before", oldestLoadedAtRef.current);
      const r = await fetch(
        `/api/design-sessions/${sessionId}/chat?${params.toString()}`,
      );
      if (!r.ok) return;
      const result: {
        messages: Array<{
          id: string;
          role: string;
          content: string;
          createdAt?: string;
        }>;
        hasMore: boolean;
      } = await r.json();
      if (!result.messages?.length) {
        setHasMoreHistory(false);
        return;
      }
      const olderMsgs = result.messages
        .filter((m) => m.role === "user" || m.role === "assistant")
        .map((m) => ({
          id: m.id,
          role: m.role as "user" | "assistant",
          content: m.content,
          parts: [{ type: "text" as const, text: m.content }],
        }));
      setMessages((current) => [current[0], ...olderMsgs, ...current.slice(1)]);
      oldestLoadedAtRef.current =
        result.messages[0]?.createdAt ?? oldestLoadedAtRef.current;
      setHasMoreHistory(result.hasMore);
    } finally {
      setLoadingMore(false);
    }
  };

  const handleSubmit = () => {
    const text = input.trim();
    if (!text || isStreaming) return;
    setInput("");
    sendMessage({ text });
  };

  const placeholder =
    existingTaskCount && existingTaskCount > 0
      ? 'Refine: "Quebre a VLD-042 em duas", "A regra X mudou"...'
      : "Liste os módulos que você identifica no brainstorm…";

  const aboveSlot = hasMoreHistory ? (
    <div className="flex justify-center px-3 pt-3">
      <Button
        variant="ghost"
        size="sm"
        disabled={loadingMore}
        onClick={loadMoreHistory}
        className="h-7 gap-1.5 text-xs text-muted-foreground hover:text-foreground"
      >
        {loadingMore && <Sparkles className="h-3 w-3 animate-pulse" />}
        {loadingMore ? "Carregando..." : "Carregar mensagens anteriores"}
      </Button>
    </div>
  ) : null;

  if (isMobile) {
    return (
      <>
        <ConversationFab
          agent="vitor"
          isOpen={mobileOpen}
          isStreaming={isStreaming}
          onClick={() => setMobileOpen(true)}
        />
        <ConversationPanel
          agent="vitor"
          variant="mobile"
          isOpen={mobileOpen}
          onOpenChange={setMobileOpen}
          onClose={() => setMobileOpen(false)}
          messages={messages}
          status={status}
          input={input}
          onInputChange={setInput}
          onSubmit={handleSubmit}
          onStop={stop}
          planMode={planMode}
          onPlanModeChange={setPlanMode}
          placeholder={placeholder}
          composerAboveSlot={aboveSlot}
        />
      </>
    );
  }

  return (
    <div className="surface flex h-full min-h-0 flex-col overflow-hidden">
      <ConversationPanel
        agent="vitor"
        variant="desktop"
        messages={messages}
        status={status}
        input={input}
        onInputChange={setInput}
        onSubmit={handleSubmit}
        onStop={stop}
        planMode={planMode}
        onPlanModeChange={setPlanMode}
        placeholder={placeholder}
        composerAboveSlot={aboveSlot}
      />
    </div>
  );
}
