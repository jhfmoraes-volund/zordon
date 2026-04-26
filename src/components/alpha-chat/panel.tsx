"use client";

import { useEffect, useRef, useState } from "react";
import { Bot, History, Loader2, Send, Wrench, X } from "lucide-react";
import type { UIMessage } from "ai";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { Markdown } from "@/components/ui/markdown";
import { cn } from "@/lib/utils";
import { useIsMobile } from "@/hooks/use-mobile";
import { useAlphaChat } from "./store";
import { useAlphaKeyboard } from "./use-alpha-keyboard";

/**
 * Renders the Alpha conversation in two shapes that share the same underlying
 * content (header + messages + composer):
 *
 * - **Desktop**: right column that lives as a flex sibling of <main>. Animates
 *   from w-0 to w-96 via transition-[width]. Inner div has w-96 fixed so the
 *   content doesn't reflow during the transition (just gets clipped by the
 *   outer overflow-hidden).
 *
 * - **Mobile**: Sheet `side="right"` full-screen. No reflow — overlays content.
 *
 * Mounted once in the dashboard layout. Trigger lives in the header and shares
 * state via AlphaChatProvider.
 *
 * Keyboard shortcut: ⌘⇧A / Ctrl+Shift+A toggles open (registered here).
 */
export function AlphaChatPanel() {
  const {
    enabled,
    isOpen,
    setOpen,
    messages,
    isLoading,
    sendMessage,
    setHistoryOpen,
  } = useAlphaChat();
  const isMobile = useIsMobile();
  const [input, setInput] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useAlphaKeyboard();

  useEffect(() => {
    if (!scrollRef.current) return;
    scrollRef.current.scrollTo({
      top: scrollRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [messages]);

  useEffect(() => {
    // preventScroll: true evita que o browser puxe a página inteira pra trazer
    // o textarea pra view (panel já tá visível, não precisa scroll do main).
    if (isOpen) {
      setTimeout(() => textareaRef.current?.focus({ preventScroll: true }), 100);
    }
  }, [isOpen]);

  if (!enabled) return null;

  const handleSend = () => {
    if (!input.trim() || isLoading) return;
    sendMessage(input);
    setInput("");
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const Header = (
    <div className="flex h-12 shrink-0 items-center justify-between border-b border-border/50 bg-muted/30 px-4">
      <div className="flex items-center gap-2">
        <Bot className="size-4 text-primary" />
        <span className="text-sm font-semibold">Alpha</span>
      </div>
      <div className="flex items-center gap-1">
        <Button
          variant="ghost"
          size="icon"
          className="size-7"
          onClick={() => setHistoryOpen(true)}
          aria-label="Histórico de conversas"
          title="Histórico de conversas"
        >
          <History className="size-3.5" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="size-7"
          onClick={() => setOpen(false)}
          aria-label="Fechar Alpha"
        >
          <X className="size-3.5" />
        </Button>
      </div>
    </div>
  );

  const Messages = (
    <div ref={scrollRef} className="flex-1 space-y-4 overflow-y-auto overscroll-contain p-4">
      {messages.length === 0 && (
        <div className="flex h-full flex-col items-center justify-center text-center text-muted-foreground">
          <Bot className="mb-3 h-10 w-10 opacity-30" />
          <p className="text-sm font-medium">Como posso ajudar?</p>
          <p className="mt-1 max-w-[250px] text-xs">
            Pergunte sobre o sprint, alocação, reuniões ou peça para criar tasks.
          </p>
        </div>
      )}

      {messages.map((msg: UIMessage) => (
        <div
          key={msg.id}
          className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}
        >
          <div
            className={`max-w-[85%] min-w-0 break-words overflow-hidden rounded-2xl text-sm ${
              msg.role === "user"
                ? "rounded-tr-sm bg-primary px-4 py-2.5 text-primary-foreground"
                : "rounded-tl-sm bg-muted px-4 py-3"
            }`}
          >
            {msg.parts?.map((part, i) => {
              if (part.type === "text") {
                return <Markdown key={i}>{part.text}</Markdown>;
              }
              if (part.type.startsWith("tool-")) {
                const toolPart = part as {
                  type: string;
                  toolCallId: string;
                  state: string;
                  title?: string;
                };
                return (
                  <div
                    key={i}
                    className="flex items-center gap-1.5 py-1 text-xs text-muted-foreground"
                  >
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

      {isLoading && messages[messages.length - 1]?.role === "user" && (
        <div className="flex justify-start">
          <div className="flex items-center gap-2 rounded-2xl rounded-tl-sm bg-muted px-4 py-3 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Pensando...
          </div>
        </div>
      )}
    </div>
  );

  const Composer = (extraClassName?: string) => (
    <div
      className={cn("shrink-0 border-t border-border/50 p-3", extraClassName)}
    >
      <div className="flex gap-2">
        <Textarea
          ref={textareaRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder="Pergunte ao Alpha..."
          rows={1}
          className="max-h-[100px] min-h-[36px] flex-1 resize-none"
        />
        <Button
          size="icon"
          disabled={!input.trim() || isLoading}
          onClick={handleSend}
          className="h-10 w-10 shrink-0"
        >
          {isLoading ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Send className="h-4 w-4" />
          )}
        </Button>
      </div>
    </div>
  );

  if (isMobile) {
    return (
      <Sheet open={isOpen} onOpenChange={setOpen}>
        <SheetContent
          side="bottom"
          showCloseButton={false}
          // data-[side=bottom]:h-[90dvh] overrides o h-auto default do Sheet
          // (mesma especificidade pra tailwind-merge resolver corretamente).
          className="flex w-full max-w-full flex-col gap-0 rounded-t-xl p-0 data-[side=bottom]:h-[90dvh] sm:max-w-full"
        >
          {Header}
          {Messages}
          {Composer("pb-safe")}
        </SheetContent>
      </Sheet>
    );
  }

  // Desktop: right column com reflow estilo Notion (transition w-0 → w-96).
  // O <aside> é flex-item da row bounded pelo wrapper h-svh do layout, então
  // nem h-svh nem sticky são necessários — flex-stretch já dá altura full.
  // Composer fica fixo embaixo via flex-col interno; mensagens scrollam dentro
  // do próprio container. Padrão Lovable / Cursor / Claude.
  return (
    <aside
      aria-hidden={!isOpen}
      className={cn(
        "z-20 shrink-0 overflow-hidden border-l border-border/50 bg-background transition-[width] duration-300 ease-in-out",
        isOpen ? "w-96" : "w-0",
      )}
    >
      <div className="flex h-full w-96 flex-col">
        {Header}
        {Messages}
        {Composer()}
      </div>
    </aside>
  );
}
