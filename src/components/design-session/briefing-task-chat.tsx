"use client";

import { memo, useEffect, useMemo, useRef, useState } from "react";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import type { UIMessage } from "ai";
import { StickToBottom, useStickToBottomContext } from "use-stick-to-bottom";
import { Button } from "@/components/ui/button";
import { ChatComposer } from "@/components/ui/chat-composer";
import { Markdown } from "@/components/ui/markdown";
import { useChatPlanMode, readPlanMode } from "@/hooks/use-chat-plan-mode";
import { ToolCallCard } from "./tool-call-card";
import { VitorBadge } from "./vitor-badge";
import { Sparkles, ArrowDown } from "lucide-react";

function mapToolState(state: string): "partial-call" | "call" | "result" {
  if (state === "input-streaming") return "partial-call";
  if (state === "input-available") return "call";
  return "result";
}

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
  const oldestLoadedAtRef = useRef<string | null>(null);
  const threadIdRef = useRef<string | null>(null);
  threadIdRef.current = threadId;

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
            return readPlanMode();
          },
        },
      }),
    [sessionId]
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

  // Expose sendMessage to parent (DesignSessionTree button handlers).
  useEffect(() => {
    if (!onSendReady) return;
    onSendReady((text: string) => {
      sendMessage({ text });
    });
    // sendMessage identity is stable across renders for useChat.
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

  // Mount: load only briefing-era messages (filter by firstMessageAt marker).
  // The thread is shared with previous steps; the marker keeps the briefing
  // chat visually clean while preserving Vitor's full context server-side.
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
          setHasMoreHistory(true); // briefing-era pode ter mais; pre-briefing definitivamente tem
        } else {
          // Briefing ainda não começou: nada na thread sob a regra do marker.
          // Mas a thread compartilhada PODE ter mensagens dos steps anteriores.
          // Sinaliza hasMore baseado no campo briefingPending: quando true, o usuário
          // ainda pode carregar histórico anterior se quiser ver conversas dos steps anteriores.
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

  // Load older messages on demand. Each click fetches a chunk of 30 from
  // the shared `web` thread, ignoring the briefing marker so the user
  // can see what was discussed in pre-work / vision / brainstorm.
  // O ResizeObserver do StickToBottom só ancora ao fim quando o usuário
  // já está colado lá; quando prependamos (load more) com o usuário no topo,
  // o navegador preserva a posição visual via overflow-anchor por default.
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
      // Prepend AFTER the welcome message; new messages stay at bottom.
      setMessages((current) => [current[0], ...olderMsgs, ...current.slice(1)]);
      oldestLoadedAtRef.current = result.messages[0]?.createdAt ?? oldestLoadedAtRef.current;
      setHasMoreHistory(result.hasMore);
    } finally {
      setLoadingMore(false);
    }
  };

  const showAnalyzing =
    isStreaming &&
    messages.length > 0 &&
    messages[messages.length - 1].role === "user";

  return (
    <div className="surface flex flex-col h-[60vh] min-h-[480px] overflow-hidden">
      {/* Messages.
          - `initial="instant"`: no primeiro paint o ResizeObserver ancora no
            fim sem animação visível, então refresh já abre na última mensagem.
          - `resize="smooth"`: durante streaming, novas mensagens fazem scroll
            suave acompanhar o conteúdo crescendo.
          - Não virtualizamos: design sessions têm dezenas-centenas de
            mensagens; DOM completo é tranquilo e elimina os bugs de
            scroll-to-bottom dos virtualizers com itens dinâmicos. */}
      <div className="relative flex-1 min-h-0">
        <div className="pointer-events-none absolute inset-x-0 top-0 z-10 h-6 bg-gradient-to-b from-card to-transparent" />
        <div className="pointer-events-none absolute inset-x-0 bottom-0 z-10 h-6 bg-gradient-to-t from-card to-transparent" />

        <StickToBottom
          className="h-full"
          initial="instant"
          resize="smooth"
        >
          <StickToBottom.Content className="px-4 pb-4">
            {hasMoreHistory && (
              <div className="flex justify-center py-2">
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={loadingMore}
                  onClick={loadMoreHistory}
                  className="text-xs text-muted-foreground hover:text-foreground gap-1.5 h-7"
                >
                  {loadingMore ? (
                    <Sparkles className="h-3 w-3 animate-pulse" />
                  ) : null}
                  {loadingMore ? "Carregando..." : "Carregar mensagens anteriores"}
                </Button>
              </div>
            )}

            <div className="space-y-4">
              {messages.map((msg) => (
                <MessageBubble key={msg.id} message={msg} />
              ))}
              {showAnalyzing && (
                <div className="flex justify-start">
                  <div className="inline-flex items-center gap-1.5 rounded-full border border-primary/20 bg-primary/[5%] px-2.5 py-1">
                    <Sparkles className="h-3 w-3 text-primary animate-pulse" />
                    <span className="shimmer-text text-xs font-medium">
                      Analisando briefing...
                    </span>
                  </div>
                </div>
              )}
            </div>
          </StickToBottom.Content>

          <ScrollToBottomFab />
        </StickToBottom>
      </div>

      <ChatInput
        isStreaming={isStreaming}
        existingTaskCount={existingTaskCount}
        onSend={(text) => sendMessage({ text })}
        onStop={stop}
      />
    </div>
  );
}

// Input isolado: o estado do textarea fica aqui, então digitar NÃO re-renderiza
// o parent (e portanto não re-renderiza a lista de mensagens). Sem isso, cada
// keystroke faz react-markdown reparsar todas as bolhas — trava em chats grandes.
function ChatInput({
  isStreaming,
  existingTaskCount,
  onSend,
  onStop,
}: {
  isStreaming: boolean;
  existingTaskCount: number | null;
  onSend: (text: string) => void;
  onStop: () => void;
}) {
  const [inputText, setInputText] = useState("");
  const { planMode, setPlanMode } = useChatPlanMode();

  const handleSend = () => {
    if (!inputText.trim() || isStreaming) return;
    const text = inputText.trim();
    setInputText("");
    onSend(text);
  };

  return (
    <div className="px-3 py-3 border-t border-border/50">
      <ChatComposer
        value={inputText}
        onChange={setInputText}
        onSubmit={handleSend}
        isStreaming={isStreaming}
        onStop={onStop}
        planMode={planMode}
        onPlanModeChange={setPlanMode}
        placeholder={
          existingTaskCount && existingTaskCount > 0
            ? 'Refine: "Quebre a VLD-042 em duas", "A regra X mudou"...'
            : 'Liste os módulos que você identifica no brainstorm…'
        }
      />
    </div>
  );
}

// FAB que aparece quando o usuário rolou pra cima — clique cola de volta no fim.
// Padrão clássico de chats AI (ChatGPT, Claude, bolt.new).
function ScrollToBottomFab() {
  const { isAtBottom, scrollToBottom } = useStickToBottomContext();
  if (isAtBottom) return null;
  return (
    <button
      type="button"
      onClick={() => scrollToBottom()}
      className="absolute bottom-3 left-1/2 -translate-x-1/2 z-20 flex h-8 w-8 items-center justify-center rounded-full border border-border bg-card shadow-md hover:bg-muted transition-colors"
      aria-label="Ir para o fim"
    >
      <ArrowDown className="h-4 w-4" />
    </button>
  );
}

// Memoizado: cada keystroke no input dispara render do parent. Sem memo,
// react-markdown re-parsea o conteúdo de TODAS as mensagens a cada tecla,
// o que trava o navegador em chats com 50+ mensagens longas.
// `useChat` mantém a referência de mensagens antigas estável — só a última
// (em streaming) muda de identidade — então shallow compare resolve.
const MessageBubble = memo(function MessageBubble({
  message,
}: {
  message: UIMessage;
}) {
  const isUser = message.role === "user";

  return (
    <div className={`flex ${isUser ? "justify-end" : "justify-start"}`}>
      <div className="max-w-[85%] min-w-0 space-y-2">
        {!isUser && <VitorBadge size="sm" />}
        {message.parts.map((part, i) => {
          if (part.type === "text" && part.text) {
            return (
              <div
                key={i}
                className={`rounded-2xl px-4 py-2.5 text-sm overflow-hidden break-words ${
                  isUser
                    ? "bg-primary text-primary-foreground rounded-tr-sm"
                    : "bg-muted rounded-tl-sm"
                }`}
              >
                <Markdown maxChars={10000}>{part.text}</Markdown>
              </div>
            );
          }

          if (part.type.startsWith("tool-")) {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const tp = part as any;
            const toolName = tp.toolName ?? part.type.replace(/^tool-/, "");
            return (
              <ToolCallCard
                key={i}
                toolName={toolName}
                args={(tp.input ?? {}) as Record<string, unknown>}
                state={mapToolState(tp.state)}
                result={tp.output}
              />
            );
          }

          return null;
        })}
      </div>
    </div>
  );
});
