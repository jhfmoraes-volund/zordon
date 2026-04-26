"use client";

import { useRef, useEffect, useState, useMemo, useCallback } from "react";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Send, Loader2, Bot, Wrench, Plus, Trash2, MessageSquare, History } from "lucide-react";
import { Markdown } from "@/components/ui/markdown";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { useIsMobile } from "@/hooks/use-mobile";
import type { UIMessage } from "ai";

type Thread = {
  id: string;
  title: string | null;
  createdAt: string;
  updatedAt: string;
};

type StoredMessage = {
  id: string;
  role: string;
  content: string;
  parts: unknown;
};

function formatRelative(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const diffMin = Math.floor(diffMs / 60000);
  if (diffMin < 1) return "agora";
  if (diffMin < 60) return `${diffMin}min`;
  const diffH = Math.floor(diffMin / 60);
  if (diffH < 24) return `${diffH}h`;
  const diffD = Math.floor(diffH / 24);
  if (diffD < 7) return `${diffD}d`;
  return new Date(iso).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
}

function toUIMessages(messages: StoredMessage[]): UIMessage[] {
  return messages
    .filter((m) => m.role === "user" || m.role === "assistant")
    .map((m) => {
      const storedParts = Array.isArray(m.parts) ? (m.parts as UIMessage["parts"]) : null;
      return {
        id: m.id,
        role: m.role as "user" | "assistant",
        parts:
          storedParts && storedParts.length > 0
            ? storedParts
            : [{ type: "text" as const, text: m.content }],
      };
    });
}

export default function OpsPage() {
  const isMobile = useIsMobile();
  const [threadId, setThreadId] = useState<string | null>(null);
  const [forceNewThread, setForceNewThread] = useState(false);
  const [threads, setThreads] = useState<Thread[]>([]);
  const [input, setInput] = useState("");
  const [historyOpen, setHistoryOpen] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Transport is stable; per-call body (threadId / newThread) is passed via
  // chat.sendMessage's options.body, since useChat does not recreate its
  // internal Chat instance when transport.body changes.
  const transport = useMemo(
    () => new DefaultChatTransport({ api: "/api/agents/alpha/chat" }),
    []
  );

  const refreshThreads = useCallback(
    async (adoptLatestIfMissing = false) => {
      const res = await fetch("/api/agents/alpha/threads");
      if (!res.ok) return;
      const data = await res.json();
      const list: Thread[] = data.threads || [];
      setThreads(list);
      if (adoptLatestIfMissing) {
        setThreadId((cur) => cur ?? list[0]?.id ?? null);
      }
    },
    []
  );

  const chat = useChat({
    transport,
    onFinish: () => {
      setForceNewThread(false);
      refreshThreads(true);
    },
  });
  const isLoading = chat.status === "streaming" || chat.status === "submitted";

  useEffect(() => {
    refreshThreads();
    fetch("/api/agents/alpha/chat")
      .then((r) => r.json())
      .then((data) => {
        if (data.threadId) setThreadId(data.threadId);
        if (data.messages?.length) chat.setMessages(toUIMessages(data.messages));
      })
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [chat.messages]);

  const sendMessage = useCallback(
    (text: string) => {
      if (!text.trim() || isLoading) return;
      setInput("");
      chat.sendMessage(
        { text },
        { body: { threadId, newThread: forceNewThread } }
      );
    },
    [chat, isLoading, threadId, forceNewThread]
  );

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage(input);
    }
  };

  const handleNewConversation = () => {
    if (isLoading) return;
    setThreadId(null);
    setForceNewThread(true);
    chat.setMessages([]);
    setHistoryOpen(false);
  };

  const handleSelectThread = async (id: string) => {
    if (id === threadId || isLoading) return;
    const res = await fetch(`/api/agents/alpha/chat?threadId=${id}`);
    if (!res.ok) return;
    const data = await res.json();
    setForceNewThread(false);
    setThreadId(id);
    chat.setMessages(toUIMessages(data.messages || []));
    setHistoryOpen(false);
  };

  const handleDeleteThread = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!confirm("Apagar esta conversa?")) return;
    const res = await fetch(`/api/agents/alpha/threads/${id}`, { method: "DELETE" });
    if (!res.ok) return;
    if (id === threadId) {
      setThreadId(null);
      chat.setMessages([]);
    }
    refreshThreads();
  };

  // Threads list — rendered inline as <aside> on desktop and inside a Sheet on mobile.
  const renderThreadsList = () => (
    <div className="flex flex-col h-full">
      <div className="p-3 border-b shrink-0">
        <Button
          variant="outline"
          size="sm"
          className="w-full justify-start gap-2"
          onClick={handleNewConversation}
          disabled={isLoading}
        >
          <Plus className="h-4 w-4" />
          Nova conversa
        </Button>
      </div>
      <div className="flex-1 overflow-y-auto p-2 space-y-1">
        {threads.length === 0 ? (
          <p className="text-xs text-muted-foreground text-center py-6 px-2">
            Nenhuma conversa anterior.
          </p>
        ) : (
          threads.map((t) => {
            const isActive = t.id === threadId;
            const title = t.title?.trim() || "Nova conversa";
            return (
              <div
                key={t.id}
                onClick={() => handleSelectThread(t.id)}
                className={`group flex items-start gap-2 px-2 py-2 rounded-md cursor-pointer text-sm ${
                  isActive ? "bg-background border" : "hover:bg-background/60"
                }`}
              >
                <MessageSquare className="h-3.5 w-3.5 mt-0.5 shrink-0 text-muted-foreground" />
                <div className="flex-1 min-w-0">
                  <div className="truncate text-xs font-medium leading-tight">{title}</div>
                  <div className="text-[10px] text-muted-foreground mt-0.5">
                    {formatRelative(t.updatedAt)}
                  </div>
                </div>
                <button
                  onClick={(e) => handleDeleteThread(t.id, e)}
                  className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive shrink-0 p-1"
                  aria-label="Apagar conversa"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            );
          })
        )}
      </div>
    </div>
  );

  return (
    <div className="flex flex-col h-[calc(100vh-5.5rem)] min-h-0">
      {/* Mobile header with "Histórico" trigger. Hidden on desktop (sidebar is visible). */}
      <div className="md:hidden flex items-center justify-between border-b px-3 py-2 shrink-0">
        <div className="flex items-center gap-2">
          <Bot className="h-4 w-4 text-primary" />
          <span className="text-sm font-semibold">Alpha</span>
        </div>
        <Button
          variant="outline"
          size="sm"
          className="gap-2"
          onClick={() => setHistoryOpen(true)}
        >
          <History className="h-4 w-4" />
          Histórico
        </Button>
      </div>

      <div className="flex flex-1 min-h-0">
        {/* Chat */}
        <div className="flex-1 flex flex-col min-w-0">
          <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-6 space-y-4">
            {chat.messages.length === 0 && (
              <div className="flex flex-col items-center justify-center h-full text-muted-foreground space-y-2">
                <Bot className="h-10 w-10" />
                <p className="text-sm">Ola! Sou o Alpha, seu assistente de operacoes.</p>
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
                          {toolPart.state === "result" && <span className="text-green-600">✓</span>}
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

          <div className="border-t p-4 shrink-0 pb-safe">
            <div className="flex gap-2">
              <Textarea
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={onKeyDown}
                placeholder="Pergunte sobre o sprint, alocação ou crie tasks..."
                rows={1}
                className="flex-1 min-h-[40px] max-h-[120px] resize-none"
              />
              <Button
                size="icon"
                disabled={!input.trim() || isLoading}
                onClick={() => sendMessage(input)}
                className="shrink-0 h-10 w-10"
              >
                {isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              </Button>
            </div>
          </div>
        </div>

        {/* Threads sidebar — desktop only */}
        <aside className="hidden md:flex w-64 border-l flex-col shrink-0 bg-muted/20">
          {renderThreadsList()}
        </aside>
      </div>

      {/* Mobile threads — bottom sheet on the right side, like Claude/ChatGPT mobile */}
      {isMobile && (
        <Sheet open={historyOpen} onOpenChange={setHistoryOpen}>
          <SheetContent side="right" className="w-[85vw] max-w-sm p-0 bg-muted/20">
            {renderThreadsList()}
          </SheetContent>
        </Sheet>
      )}
    </div>
  );
}
