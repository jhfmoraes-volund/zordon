"use client";

import { useRef, useEffect, useState, useMemo, useCallback } from "react";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Send, Loader2, Bot, Wrench, MessageCircle, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Markdown } from "@/components/ui/markdown";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import type { UIMessage } from "ai";
import { useAuth } from "@/contexts/auth-context";
import { hasMinLevel, MANAGER } from "@/lib/roles";
import { useIsMobile } from "@/hooks/use-mobile";

type AlphaChatProps = {
  /** Label shown in the chat header (e.g. project name, meeting date) */
  contextLabel?: string;
  /** Extra body params sent with each message (projectId, meetingId, etc.) */
  contextParams?: Record<string, string>;
};

/**
 * Floating chat bubble + panel for Alpha.
 * Drop into any page to give contextual ops assistance.
 */
export function AlphaChat({ contextLabel, contextParams }: AlphaChatProps) {
  const { effectiveRole } = useAuth();
  const isMobile = useIsMobile();
  const [isOpen, setIsOpen] = useState(false);
  const [input, setInput] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const transport = useMemo(
    () =>
      new DefaultChatTransport({
        api: "/api/agents/alpha/chat",
        body: { ...contextParams },
      }),
    [contextParams]
  );

  const chat = useChat({ transport });
  const isLoading = chat.status === "streaming" || chat.status === "submitted";

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [chat.messages]);

  useEffect(() => {
    if (isOpen) setTimeout(() => textareaRef.current?.focus(), 100);
  }, [isOpen]);

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

  // Alpha is manager-only; hide the bubble entirely for Builders.
  if (!hasMinLevel(effectiveRole, MANAGER)) return null;

  // Shared chat body (header + messages + composer). Used by both desktop panel
  // and mobile sheet so state and refs stay top-level.
  const renderHeader = () => (
    <div className="flex items-center justify-between px-4 py-3 border-b bg-muted/30 shrink-0">
      <div className="flex items-center gap-2">
        <Bot className="h-5 w-5 text-primary" />
        <span className="text-sm font-semibold">Alpha</span>
      </div>
      {contextLabel && (
        <Badge variant="secondary" className="text-xs truncate max-w-[180px]">
          {contextLabel}
        </Badge>
      )}
    </div>
  );

  const renderMessages = () => (
    <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 space-y-4">
      {chat.messages.length === 0 && (
        <div className="flex flex-col items-center justify-center h-full text-center text-muted-foreground">
          <Bot className="h-10 w-10 mb-3 opacity-30" />
          <p className="text-sm font-medium">Como posso ajudar?</p>
          <p className="text-xs mt-1 max-w-[250px]">
            Pergunte sobre o sprint, alocacao, reunioes ou peca para criar tasks.
          </p>
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
  );

  const renderComposer = (extraClassName = "") => (
    <div className={`border-t p-3 shrink-0 ${extraClassName}`}>
      <div className="flex gap-2">
        <Textarea
          ref={textareaRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder="Pergunte ao Alpha..."
          rows={1}
          className="flex-1 min-h-[36px] max-h-[100px] resize-none"
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
  );

  // Bubble button — shared between desktop and mobile. On mobile it sits above
  // the home indicator via safe-area inset.
  const renderBubble = () => (
    <div
      className="fixed right-6 z-50"
      style={{ bottom: "calc(1.5rem + env(safe-area-inset-bottom))" }}
    >
      <Button
        onClick={() => setIsOpen((p) => !p)}
        size="icon"
        className="h-14 w-14 rounded-full shadow-lg"
      >
        {isOpen ? (
          <X className="h-6 w-6" />
        ) : (
          <div className="relative">
            <MessageCircle className="h-6 w-6" />
            {isLoading && (
              <span className="absolute -top-1 -right-1 h-3 w-3 rounded-full bg-yellow-400 animate-pulse" />
            )}
          </div>
        )}
      </Button>
    </div>
  );

  if (isMobile) {
    return (
      <>
        {renderBubble()}
        <Sheet open={isOpen} onOpenChange={setIsOpen}>
          <SheetContent
            side="bottom"
            showCloseButton={false}
            className="h-[100dvh] p-0 gap-0 flex flex-col rounded-none"
          >
            {renderHeader()}
            {renderMessages()}
            {renderComposer("pb-safe")}
          </SheetContent>
        </Sheet>
      </>
    );
  }

  // Desktop: floating bubble + fixed panel
  return (
    <>
      {renderBubble()}

      {isOpen && (
        <div className="fixed bottom-24 right-6 z-50 w-[420px] h-[550px] flex flex-col rounded-2xl border bg-background shadow-2xl overflow-hidden">
          {renderHeader()}
          {renderMessages()}
          {renderComposer()}
        </div>
      )}
    </>
  );
}
