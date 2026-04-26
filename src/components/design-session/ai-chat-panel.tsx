"use client";

import { useRef, useEffect } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { Send, Loader2, Bot, Wrench, X } from "lucide-react";
import type { UIMessage } from "ai";
import { Markdown } from "@/components/ui/markdown";
import { useIsMobile } from "@/hooks/use-mobile";

export function AIChatPanel({
  isOpen,
  messages,
  input,
  isLoading,
  currentStepTitle,
  onInputChange,
  onSubmit,
  onOpenChange,
}: {
  isOpen: boolean;
  messages: UIMessage[];
  input: string;
  isLoading: boolean;
  currentStepTitle: string;
  onInputChange: (value: string) => void;
  onSubmit: (e: React.FormEvent) => void;
  onOpenChange?: (open: boolean) => void;
}) {
  const isMobile = useIsMobile();
  const scrollRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, isLoading]);

  useEffect(() => {
    if (isOpen) {
      setTimeout(() => textareaRef.current?.focus({ preventScroll: true }), 100);
    }
  }, [isOpen]);

  const Header = (
    <div className="flex h-12 shrink-0 items-center justify-between border-b border-border/50 bg-muted/30 px-4">
      <div className="flex items-center gap-2">
        <Bot className="size-4 text-primary" />
        <span className="text-sm font-semibold">Assistente de Design</span>
      </div>
      <div className="flex items-center gap-2">
        <Badge variant="secondary" className="text-xs">
          {currentStepTitle}
        </Badge>
        {isMobile && onOpenChange && (
          <Button
            variant="ghost"
            size="icon"
            className="size-7"
            onClick={() => onOpenChange(false)}
            aria-label="Fechar assistente"
          >
            <X className="size-3.5" />
          </Button>
        )}
      </div>
    </div>
  );

  const Messages = (
    <div ref={scrollRef} className="flex-1 space-y-5 overflow-y-auto overscroll-contain p-4">
      {messages.length === 0 && !isLoading && (
        <div className="flex h-full flex-col items-center justify-center text-center text-muted-foreground">
          <Bot className="mb-3 h-10 w-10 opacity-30" />
          <p className="text-sm font-medium">Como posso ajudar?</p>
          <p className="mt-1 max-w-[250px] text-xs">
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
  );

  const Composer = (
    <form onSubmit={onSubmit} className="shrink-0 border-t border-border/50 p-3 pb-safe">
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
          className="max-h-[100px] min-h-[40px] flex-1 resize-none text-sm"
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
  );

  if (isMobile) {
    return (
      <Sheet open={isOpen} onOpenChange={onOpenChange}>
        <SheetContent
          side="bottom"
          showCloseButton={false}
          className="flex w-full max-w-full flex-col gap-0 rounded-t-xl p-0 data-[side=bottom]:h-[90dvh] sm:max-w-full"
        >
          {Header}
          {Messages}
          {Composer}
        </SheetContent>
      </Sheet>
    );
  }

  if (!isOpen) return null;

  return (
    <div className="fixed bottom-24 right-6 z-50 flex h-[550px] w-[420px] flex-col overflow-hidden rounded-2xl border bg-background shadow-2xl">
      {Header}
      {Messages}
      {Composer}
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
