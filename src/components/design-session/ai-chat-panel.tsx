"use client";

import { useRef, useEffect, useLayoutEffect } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { Send, Loader2, Wrench, X } from "lucide-react";
import type { UIMessage } from "ai";
import { Markdown } from "@/components/ui/markdown";
import { useIsMobile } from "@/hooks/use-mobile";
import { VitorIcon } from "@/components/icons/vitor-icon";
import { VitorBadge } from "./vitor-badge";

type ChatContentProps = {
  messages: UIMessage[];
  input: string;
  isLoading: boolean;
  currentStepTitle: string;
  onInputChange: (value: string) => void;
  onSubmit: (e: React.FormEvent) => void;
  onClose?: () => void;
};

function AIChatContent({
  messages,
  input,
  isLoading,
  currentStepTitle,
  onInputChange,
  onSubmit,
  onClose,
}: ChatContentProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const stickToBottomRef = useRef(true);

  // Empty state precisa ocupar toda a altura quando nao ha mensagem
  const showEmpty = messages.length === 0 && !isLoading;
  const showThinking = isLoading && messages[messages.length - 1]?.role !== "assistant";

  // Virtualizer: 1 item por mensagem + 1 opcional pro indicador "Pensando..."
  const itemCount = messages.length + (showThinking ? 1 : 0);

  const virtualizer = useVirtualizer({
    count: itemCount,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 120, // estimativa inicial — auto-mede depois
    overscan: 4,
    measureElement:
      typeof window !== "undefined" && navigator.userAgent.indexOf("Firefox") === -1
        ? (el) => el?.getBoundingClientRect().height
        : undefined,
  });

  // Detecta se usuario rolou pra cima — desativa stick-to-bottom
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const onScroll = () => {
      const distFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
      stickToBottomRef.current = distFromBottom < 80;
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => el.removeEventListener("scroll", onScroll);
  }, []);

  // Scroll-to-bottom durante streaming/novas mensagens — só se usuario nao rolou pra cima
  useLayoutEffect(() => {
    if (itemCount === 0) return;
    if (!stickToBottomRef.current) return;
    virtualizer.scrollToIndex(itemCount - 1, { align: "end" });
  }, [itemCount, virtualizer, messages]);

  useEffect(() => {
    const t = setTimeout(() => textareaRef.current?.focus({ preventScroll: true }), 100);
    return () => clearTimeout(t);
  }, []);

  const virtualItems = virtualizer.getVirtualItems();
  const totalSize = virtualizer.getTotalSize();

  return (
    <>
      <div className="flex h-12 shrink-0 items-center justify-between border-b border-border/50 bg-muted/30 px-4">
        <VitorBadge size="sm" />
        <div className="flex items-center gap-2">
          <Badge variant="secondary" className="text-xs">
            {currentStepTitle}
          </Badge>
          {onClose && (
            <Button
              variant="ghost"
              size="icon"
              className="size-7"
              onClick={onClose}
              aria-label="Fechar assistente"
            >
              <X className="size-3.5" />
            </Button>
          )}
        </div>
      </div>

      <div ref={scrollRef} className="flex-1 overflow-y-auto overscroll-contain">
        {showEmpty ? (
          <div className="flex h-full flex-col items-center justify-center text-center text-muted-foreground p-4">
            <VitorIcon className="mb-3 h-10 w-10 text-[oklch(0.74_0.18_55)]/40" strokeWidth={1.75} />
            <p className="text-sm font-medium">Como posso ajudar?</p>
            <p className="mt-1 max-w-[250px] text-xs">
              Posso preencher campos, criar cards, sugerir melhorias e analisar a sessao.
            </p>
          </div>
        ) : (
          <div
            className="relative w-full p-4"
            style={{ height: `${totalSize}px` }}
          >
            {virtualItems.map((virtualItem) => {
              const idx = virtualItem.index;
              const isThinkingItem = showThinking && idx === messages.length;
              const msg = !isThinkingItem ? messages[idx] : null;

              return (
                <div
                  key={virtualItem.key}
                  ref={virtualizer.measureElement}
                  data-index={idx}
                  className="absolute left-0 right-0 px-4 pb-5"
                  style={{ transform: `translateY(${virtualItem.start}px)` }}
                >
                  {isThinkingItem ? (
                    <div className="flex items-center gap-2 text-muted-foreground">
                      <Loader2 className="h-4 w-4 animate-spin" />
                      <span className="text-xs">Pensando...</span>
                    </div>
                  ) : msg ? (
                    <MessageBubble message={msg} />
                  ) : null}
                </div>
              );
            })}
          </div>
        )}
      </div>

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
    </>
  );
}

export function AIChatMobileSheet({
  isOpen,
  onOpenChange,
  ...content
}: ChatContentProps & {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const isMobile = useIsMobile();
  if (!isMobile) return null;
  return (
    <Sheet open={isOpen} onOpenChange={onOpenChange}>
      <SheetContent
        side="bottom"
        showCloseButton={false}
        className="flex w-full max-w-full flex-col gap-0 rounded-t-xl p-0 data-[side=bottom]:h-[90dvh] sm:max-w-full"
      >
        <AIChatContent {...content} onClose={() => onOpenChange(false)} />
      </SheetContent>
    </Sheet>
  );
}

export function AIChatDesktopPanel(props: ChatContentProps) {
  return (
    <div className="flex h-full w-full flex-col overflow-hidden rounded-2xl border bg-background shadow-sm">
      <AIChatContent {...props} />
    </div>
  );
}

function MessageBubble({ message }: { message: UIMessage }) {
  const isUser = message.role === "user";

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
        className={`max-w-[85%] min-w-0 space-y-2`}
      >
        {!isUser && <VitorBadge size="sm" />}
        <div
          className={`rounded-2xl text-sm overflow-hidden break-words ${
            isUser
              ? "px-3 py-2 bg-primary text-primary-foreground rounded-tr-sm"
              : "px-4 py-3 bg-muted rounded-tl-sm"
          }`}
        >
          <Markdown maxChars={10000}>{textContent}</Markdown>
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
