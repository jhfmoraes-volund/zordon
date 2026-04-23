"use client";

import { useRef, useEffect, useState, useMemo, useCallback } from "react";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Send, Loader2, Bot, User, Wrench } from "lucide-react";
import { Markdown } from "@/components/ui/markdown";
import { PageHeader } from "@/components/page-header";
import type { UIMessage } from "ai";

export default function OpsPage() {
  const [threadId, setThreadId] = useState<string | null>(null);
  const [input, setInput] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);

  const transport = useMemo(
    () =>
      new DefaultChatTransport({
        api: "/api/agents/zordon/chat",
        body: { threadId },
      }),
    [threadId]
  );

  const chat = useChat({ transport });
  const isLoading = chat.status === "streaming" || chat.status === "submitted";

  // Load existing history on mount
  useEffect(() => {
    fetch("/api/agents/zordon/chat")
      .then((r) => r.json())
      .then((data) => {
        if (data.threadId) setThreadId(data.threadId);
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
  }, []);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [chat.messages]);

  const sendMessage = useCallback(
    (text: string) => {
      if (!text.trim() || isLoading) return;
      setInput("");
      chat.sendMessage({ text });
    },
    [chat.sendMessage, isLoading]
  );

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage(input);
    }
  };

  return (
    <div className="flex flex-col h-[calc(100vh-7.5rem)]">
      <PageHeader title="Zordon — Operações" />

      {/* Messages */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-6 space-y-4">
        {chat.messages.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full text-muted-foreground space-y-2">
            <Bot className="h-10 w-10" />
            <p className="text-sm">Ola! Sou o Zordon, seu assistente de operacoes.</p>
            <p className="text-xs">Pergunte sobre o sprint, alocacao da equipe, ou peca para criar tasks.</p>
          </div>
        )}

        {chat.messages.map((msg: UIMessage) => (
          <div
            key={msg.id}
            className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}
          >
            <div
              className={`max-w-[85%] min-w-0 rounded-2xl text-sm overflow-hidden break-words ${
                msg.role === "user"
                  ? "px-4 py-2.5 bg-primary text-primary-foreground rounded-tr-sm"
                  : "px-4 py-3 bg-muted rounded-tl-sm"
              }`}
            >
              {msg.parts?.map((part, i) => {
                if (part.type === "text") {
                  return <Markdown key={i}>{part.text}</Markdown>;
                }
                if (part.type.startsWith("tool-")) {
                  const toolPart = part as { type: string; toolCallId: string; state: string; title?: string };
                  return (
                    <div key={i} className="flex items-center gap-1.5 text-xs text-muted-foreground py-1">
                      <Wrench className="h-3 w-3" />
                      <span>{toolPart.title || toolPart.toolCallId}</span>
                      {toolPart.state === "result" && (
                        <span className="text-green-600">✓</span>
                      )}
                    </div>
                  );
                }
                return null;
              })}
            </div>
          </div>
        ))}

        {isLoading && chat.messages[chat.messages.length - 1]?.role === "user" && (
          <div className="flex justify-start">
            <div className="bg-muted rounded-2xl rounded-tl-sm px-4 py-3 text-sm text-muted-foreground flex items-center gap-2">
              <Loader2 className="h-4 w-4 animate-spin" />
              Pensando...
            </div>
          </div>
        )}
      </div>

      {/* Input */}
      <div className="border-t p-4 shrink-0">
        <div className="flex gap-2">
          <Textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="Pergunte sobre o sprint, alocação ou crie tasks..."
            rows={1}
            className="flex-1 min-h-[40px] max-h-[120px] resize-none text-sm"
          />
          <Button
            size="icon"
            disabled={!input.trim() || isLoading}
            onClick={() => sendMessage(input)}
            className="shrink-0"
          >
            {isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
          </Button>
        </div>
      </div>
    </div>
  );
}
