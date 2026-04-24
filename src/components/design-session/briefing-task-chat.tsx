"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import type { UIMessage } from "ai";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Markdown } from "@/components/ui/markdown";
import { ToolCallCard } from "./tool-call-card";
import { Send, Square, Sparkles } from "lucide-react";

function mapToolState(state: string): "partial-call" | "call" | "result" {
  if (state === "input-streaming") return "partial-call";
  if (state === "input-available") return "call";
  return "result";
}

const GENERATE_PROMPT =
  "Gere as tasks técnicas para este projeto. Comece pelo Passo 1: apresente o mapa funcional das funcionalidades MVP para eu validar antes de criar as tasks.";

const WELCOME_TEXT =
  "Oi! Sou o Vitor. Já estudei o briefing desta session e posso gerar as tasks técnicas para o time — ou refinar as que já existem com base em novas regras de negócio e gaps que surgirem.\n\nQuando estiver pronto, clique em **Gerar tasks** abaixo. Ou, se já existem tasks, me diga o que quer ajustar e eu mexo cirurgicamente no que precisa.";

export function BriefingTaskChat({
  sessionId,
  onTasksChanged,
}: {
  sessionId: string;
  onTasksChanged?: () => void;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [inputText, setInputText] = useState("");
  const [threadId, setThreadId] = useState<string | null>(null);
  const [existingTaskCount, setExistingTaskCount] = useState<number | null>(null);
  const [hasTriggeredGeneration, setHasTriggeredGeneration] = useState(false);
  const threadIdRef = useRef<string | null>(null);
  threadIdRef.current = threadId;

  const transport = useMemo(
    () =>
      new DefaultChatTransport({
        api: `/api/design-sessions/${sessionId}/chat`,
        body: {
          sessionId,
          currentStepKey: "briefing",
          channel: "briefing",
          get threadId() {
            return threadIdRef.current;
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

  // Load chat history + task count on mount
  useEffect(() => {
    let cancelled = false;
    fetch(`/api/design-sessions/${sessionId}/chat?channel=briefing`)
      .then((r) => (r.ok ? r.json() : { threadId: null, messages: [] }))
      .then((result) => {
        if (cancelled) return;
        if (result.threadId) setThreadId(result.threadId);
        if (result.messages?.length) {
          const restored = result.messages
            .filter(
              (m: { role: string }) =>
                m.role === "user" || m.role === "assistant"
            )
            .map((m: { id: string; role: string; content: string }) => ({
              id: m.id,
              role: m.role as "user" | "assistant",
              content: m.content,
              parts: [{ type: "text" as const, text: m.content }],
            }));
          setMessages([initialMsg, ...restored]);
          setHasTriggeredGeneration(true);
        }
      })
      .catch(() => {});
    refreshTaskCount();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId]);

  useEffect(() => {
    scrollRef.current?.scrollTo(0, scrollRef.current.scrollHeight);
  }, [messages, isStreaming]);

  const handleSend = () => {
    if (!inputText.trim() || isStreaming) return;
    const text = inputText.trim();
    setInputText("");
    sendMessage({ text });
  };

  const handleGenerate = () => {
    if (isStreaming) return;
    setHasTriggeredGeneration(true);
    sendMessage({ text: GENERATE_PROMPT });
  };

  const showGenerateButton =
    existingTaskCount === 0 && !hasTriggeredGeneration && !isStreaming;

  return (
    <div className="surface flex flex-col h-[60vh] min-h-[480px] overflow-hidden">
      {/* Messages */}
      <div className="relative flex-1 min-h-0">
        <div className="pointer-events-none absolute inset-x-0 top-0 z-10 h-6 bg-gradient-to-b from-card to-transparent" />
        <div className="pointer-events-none absolute inset-x-0 bottom-0 z-10 h-6 bg-gradient-to-t from-card to-transparent" />

        <div
          ref={scrollRef}
          className="h-full overflow-y-auto space-y-4 px-4 py-6 scroll-smooth"
        >
          {messages.map((msg, idx) => (
            <MessageBubble key={`${msg.id}-${idx}`} message={msg} />
          ))}

          {isStreaming &&
            messages.length > 0 &&
            messages[messages.length - 1].role === "user" && (
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
      </div>

      {/* Generate button */}
      {showGenerateButton && (
        <div className="flex justify-center px-4 py-2 border-t border-border/50">
          <Button
            variant="outline"
            className="gap-2 border-primary/30 text-primary hover:bg-primary/5"
            onClick={handleGenerate}
          >
            <Sparkles className="h-4 w-4" />
            Gerar tasks
          </Button>
        </div>
      )}

      {/* Input */}
      <div className="flex items-end gap-2 px-4 py-3 border-t border-border/50">
        <Textarea
          value={inputText}
          onChange={(e) => setInputText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              handleSend();
            }
          }}
          placeholder={
            existingTaskCount && existingTaskCount > 0
              ? 'Refine: "Quebre a VLD-042 em duas", "A regra X mudou"...'
              : "Converse com o Vitor ou clique em Gerar tasks..."
          }
          rows={1}
          className="resize-none text-sm min-h-[40px] max-h-[120px]"
          disabled={isStreaming}
        />
        {isStreaming ? (
          <Button
            size="icon"
            variant="destructive"
            className="h-10 w-10 shrink-0 animate-pulse"
            onClick={stop}
          >
            <Square className="h-3.5 w-3.5" />
          </Button>
        ) : (
          <Button
            size="icon"
            className="h-10 w-10 shrink-0"
            disabled={!inputText.trim()}
            onClick={handleSend}
          >
            <Send className="h-4 w-4" />
          </Button>
        )}
      </div>
    </div>
  );
}

function MessageBubble({ message }: { message: UIMessage }) {
  const isUser = message.role === "user";

  return (
    <div className={`flex ${isUser ? "justify-end" : "justify-start"}`}>
      <div className="max-w-[85%] min-w-0 space-y-2">
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
                <Markdown>{part.text}</Markdown>
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
}
