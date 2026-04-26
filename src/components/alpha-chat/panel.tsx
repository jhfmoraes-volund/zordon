"use client";

import { useEffect, useRef, useState } from "react";
import { Bot, Loader2, Send, Wrench } from "lucide-react";
import type { UIMessage } from "ai";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { Markdown } from "@/components/ui/markdown";
import { useIsMobile } from "@/hooks/use-mobile";
import { useAlphaChat } from "./store";

/**
 * Renders the Alpha conversation. On mobile it lives in a bottom sheet (full
 * height); on desktop it is a fixed 420×550 panel anchored to bottom-right.
 *
 * Mounted once at the dashboard layout level. Trigger lives separately
 * (header on mobile, floating bubble on desktop) and shares state via
 * AlphaChatProvider.
 */
export function AlphaChatPanel() {
  const { enabled, isOpen, setOpen, messages, isLoading, sendMessage } = useAlphaChat();
  const isMobile = useIsMobile();
  const [input, setInput] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (!scrollRef.current) return;
    scrollRef.current.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages]);

  useEffect(() => {
    if (isOpen) setTimeout(() => textareaRef.current?.focus(), 100);
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

  const renderHeader = () => (
    <div className="flex items-center justify-between px-4 py-3 border-b bg-muted/30 shrink-0">
      <div className="flex items-center gap-2">
        <Bot className="h-5 w-5 text-primary" />
        <span className="text-sm font-semibold">Alpha</span>
      </div>
    </div>
  );

  const renderMessages = () => (
    <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 space-y-4">
      {messages.length === 0 && (
        <div className="flex flex-col items-center justify-center h-full text-center text-muted-foreground">
          <Bot className="h-10 w-10 mb-3 opacity-30" />
          <p className="text-sm font-medium">Como posso ajudar?</p>
          <p className="text-xs mt-1 max-w-[250px]">
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

      {isLoading && messages[messages.length - 1]?.role === "user" && (
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
          onClick={handleSend}
          className="shrink-0 h-10 w-10"
        >
          {isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
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
          className="h-[100dvh] p-0 gap-0 flex flex-col rounded-none"
        >
          {renderHeader()}
          {renderMessages()}
          {renderComposer("pb-safe")}
        </SheetContent>
      </Sheet>
    );
  }

  if (!isOpen) return null;

  return (
    <div className="fixed bottom-24 right-6 z-50 w-[420px] h-[550px] flex flex-col rounded-2xl border bg-background shadow-2xl overflow-hidden">
      {renderHeader()}
      {renderMessages()}
      {renderComposer()}
    </div>
  );
}
