"use client";

import { type ReactNode, useEffect, useLayoutEffect, useRef } from "react";
import type { UIMessage } from "@ai-sdk/react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { cn } from "@/lib/utils";
import { type AgentId } from "./agent-themes";
import { MessageBubble } from "./message-bubble";
import { ThinkingIndicator } from "./thinking-indicator";

export type MessageListStatus = "idle" | "submitted" | "streaming";

type Props = {
  agent: AgentId;
  messages: UIMessage[];
  status: MessageListStatus;
  emptyState?: ReactNode;
  /** Optional render after a given message — used for "Executar plano" button. */
  renderAfterMessage?: (message: UIMessage, index: number) => ReactNode;
  className?: string;
};

export function MessageList({
  agent,
  messages,
  status,
  emptyState,
  renderAfterMessage,
  className,
}: Props) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const stickyRef = useRef(true);
  const didInitialJumpRef = useRef(false);

  const isWaiting = status === "streaming" || status === "submitted";
  const lastMsg = messages[messages.length - 1];
  const showThinking = isWaiting && (!lastMsg || lastMsg.role !== "assistant");

  const itemCount = messages.length + (showThinking ? 1 : 0);

  const virtualizer = useVirtualizer({
    count: itemCount,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 120,
    overscan: 4,
    measureElement:
      typeof window !== "undefined" &&
      navigator.userAgent.indexOf("Firefox") === -1
        ? (el) => el?.getBoundingClientRect().height
        : undefined,
  });

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const onScroll = () => {
      const dist = el.scrollHeight - el.scrollTop - el.clientHeight;
      stickyRef.current = dist < 80;
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => el.removeEventListener("scroll", onScroll);
  }, []);

  useLayoutEffect(() => {
    if (itemCount === 0) return;
    if (!didInitialJumpRef.current) {
      virtualizer.scrollToIndex(itemCount - 1, {
        align: "end",
        behavior: "auto",
      });
      didInitialJumpRef.current = true;
      return;
    }
    if (stickyRef.current) {
      virtualizer.scrollToIndex(itemCount - 1, { align: "end" });
    }
  }, [itemCount, virtualizer, messages]);

  if (messages.length === 0 && !showThinking) {
    return (
      <div
        className={cn(
          "flex flex-1 items-center justify-center overflow-y-auto p-4",
          className,
        )}
      >
        {emptyState}
      </div>
    );
  }

  const virtualItems = virtualizer.getVirtualItems();
  const totalSize = virtualizer.getTotalSize();

  return (
    <div
      ref={scrollRef}
      className={cn("flex-1 overflow-y-auto overscroll-contain", className)}
    >
      <div
        className="relative w-full p-4"
        style={{ height: `${totalSize}px` }}
      >
        {virtualItems.map((vi) => {
          const idx = vi.index;
          const isThinkingItem = showThinking && idx === messages.length;
          const msg = !isThinkingItem ? messages[idx] : null;

          return (
            <div
              key={vi.key}
              ref={virtualizer.measureElement}
              data-index={idx}
              className="absolute left-0 right-0 px-4 pb-5"
              style={{ transform: `translateY(${vi.start}px)` }}
            >
              {isThinkingItem ? (
                <ThinkingIndicator />
              ) : msg ? (
                <>
                  <MessageBubble agent={agent} message={msg} />
                  {renderAfterMessage?.(msg, idx)}
                </>
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}
