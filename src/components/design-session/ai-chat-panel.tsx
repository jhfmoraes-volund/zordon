"use client";

import { useRef, useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Send, Loader2, Bot, User, Wrench } from "lucide-react";
import type { UIMessage } from "ai";
import { Markdown } from "@/components/ui/markdown";

export function AIChatPanel({
  isOpen,
  messages,
  input,
  isLoading,
  currentStepTitle,
  onInputChange,
  onSubmit,
}: {
  isOpen: boolean;
  messages: UIMessage[];
  input: string;
  isLoading: boolean;
  currentStepTitle: string;
  onInputChange: (value: string) => void;
  onSubmit: (e: React.FormEvent) => void;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Auto-scroll on new messages
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, isLoading]);

  // Focus textarea when panel opens
  useEffect(() => {
    if (isOpen) {
      setTimeout(() => textareaRef.current?.focus(), 100);
    }
  }, [isOpen]);

  if (!isOpen) return null;

  return (
    <div className="fixed bottom-24 right-6 z-50 w-[420px] h-[550px] flex flex-col rounded-2xl border bg-background shadow-2xl overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b bg-muted/30">
        <div className="flex items-center gap-2">
          <Bot className="h-5 w-5 text-primary" />
          <span className="text-sm font-semibold">Assistente de Design</span>
        </div>
        <Badge variant="secondary" className="text-xs">
          {currentStepTitle}
        </Badge>
      </div>

      {/* Messages */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 space-y-5">
        {messages.length === 0 && !isLoading && (
          <div className="flex flex-col items-center justify-center h-full text-center text-muted-foreground">
            <Bot className="h-10 w-10 mb-3 opacity-30" />
            <p className="text-sm font-medium">Como posso ajudar?</p>
            <p className="text-xs mt-1 max-w-[250px]">
              Posso preencher campos, criar cards, sugerir melhorias e analisar a sessao.
            </p>
          </div>
        )}

        {messages.map((msg, idx) => (
          <MessageBubble key={`${msg.id}-${idx}`} message={msg} />
        ))}

        {isLoading && messages[messages.length - 1]?.role !== "assistant" && (
          <div className="flex items-center gap-2 text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            <span className="text-xs">Pensando...</span>
          </div>
        )}
      </div>

      {/* Input */}
      <form onSubmit={onSubmit} className="border-t p-3">
        <div className="flex gap-2">
          <Textarea
            ref={textareaRef}
            value={input}
            onChange={(e) => onInputChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                if (input.trim() && !isLoading) {
                  onSubmit(e);
                }
              }
            }}
            placeholder="Pergunte ou peça algo..."
            rows={1}
            className="resize-none text-sm min-h-[40px] max-h-[100px]"
          />
          <Button
            type="submit"
            size="icon"
            className="h-10 w-10 shrink-0"
            disabled={!input.trim() || isLoading}
          >
            {isLoading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Send className="h-4 w-4" />
            )}
          </Button>
        </div>
      </form>
    </div>
  );
}

function MessageBubble({ message }: { message: UIMessage }) {
  const isUser = message.role === "user";

  // Count tool calls in parts
  const toolParts = message.parts?.filter(
    (p) => p.type === "tool-invocation"
  ) || [];
  const textContent = message.parts
    ?.filter((p) => p.type === "text")
    .map((p) => (p as { type: "text"; text: string }).text)
    .join("") || "";

  return (
    <div className={`flex ${isUser ? "justify-end" : "justify-start"}`}>
      <div
        className={`max-w-[85%] min-w-0 space-y-1`}
      >
        <div
          className={`rounded-2xl text-sm overflow-hidden break-words ${
            isUser
              ? "px-3 py-2 bg-primary text-primary-foreground rounded-tr-sm"
              : "px-4 py-3 bg-muted rounded-tl-sm"
          }`}
        >
          <Markdown>{textContent}</Markdown>
        </div>

        {toolParts.length > 0 && (
          <div className="flex items-center gap-1 px-1">
            <Wrench className="h-3 w-3 text-muted-foreground" />
            <span className="text-[10px] text-muted-foreground">
              {toolParts.length === 1
                ? "Aplicou 1 alteração"
                : `Aplicou ${toolParts.length} alterações`}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
