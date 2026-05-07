"use client";

import { type ReactNode, useEffect, useLayoutEffect, useRef } from "react";
import type { UIMessage } from "@ai-sdk/react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { type AgentId } from "./agent-themes";
import { MessageBubble } from "./message-bubble";
import { ThinkingIndicator } from "./thinking-indicator";

export type MessageListStatus = "idle" | "submitted" | "streaming" | "error" | "ready";

type Props = {
  agent: AgentId;
  messages: UIMessage[];
  status: MessageListStatus;
  emptyState?: ReactNode;
  /** Optional render after a given message — used for "Executar plano" button. */
  renderAfterMessage?: (message: UIMessage, index: number) => ReactNode;
  /** When true, an IntersectionObserver near the top fires `onLoadOlder` to prepend history. */
  hasOlder?: boolean;
  isLoadingOlder?: boolean;
  onLoadOlder?: () => void;
  className?: string;
};

export function MessageList({
  agent,
  messages,
  status,
  emptyState,
  renderAfterMessage,
  hasOlder,
  isLoadingOlder,
  onLoadOlder,
  className,
}: Props) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const sentinelRef = useRef<HTMLDivElement>(null);
  const stickyRef = useRef(true);
  const didInitialJumpRef = useRef(false);

  const isWaiting = status === "streaming" || status === "submitted";
  const lastMsg = messages[messages.length - 1];
  const lastIsAssistant = lastMsg?.role === "assistant";
  const showThinking = isWaiting && !lastIsAssistant;

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

  // Scroll-anchor preservation: when older messages are prepended, the virtualizer's
  // total size grows from the top. Without compensation, the viewport visually jumps
  // because scrollTop stays the same while content above it expands. We track the id
  // of the first message and the totalSize before the prepend, then on layout we shift
  // scrollTop by the delta so the user's view remains pinned to what they were reading.
  const firstIdRef = useRef<string | null>(messages[0]?.id ?? null);
  const prevTotalSizeRef = useRef<number>(0);

  // Auto-trigger load when sentinel intersects the scroll viewport.
  useEffect(() => {
    if (!onLoadOlder) return;
    const sentinel = sentinelRef.current;
    const root = scrollRef.current;
    if (!sentinel || !root) return;
    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[0];
        if (!entry?.isIntersecting) return;
        if (!hasOlder || isLoadingOlder) return;
        onLoadOlder();
      },
      { root, rootMargin: "300px 0px 0px 0px", threshold: 0 },
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [hasOlder, isLoadingOlder, onLoadOlder]);

  useLayoutEffect(() => {
    if (itemCount === 0) return;
    const newFirstId = messages[0]?.id ?? null;
    const prependedAtTop =
      didInitialJumpRef.current &&
      firstIdRef.current !== null &&
      newFirstId !== firstIdRef.current;

    if (!didInitialJumpRef.current) {
      virtualizer.scrollToIndex(itemCount - 1, {
        align: "end",
        behavior: "auto",
      });
      didInitialJumpRef.current = true;
    } else if (prependedAtTop) {
      // Force re-measure so getTotalSize reflects the new prepended items, then
      // shift scrollTop by the size delta to keep viewport visually pinned.
      virtualizer.measure();
      const newTotal = virtualizer.getTotalSize();
      const delta = newTotal - prevTotalSizeRef.current;
      const el = scrollRef.current;
      if (el && delta > 0) {
        el.scrollTop += delta;
      }
    } else if (stickyRef.current) {
      virtualizer.scrollToIndex(itemCount - 1, { align: "end" });
    }

    firstIdRef.current = newFirstId;
    prevTotalSizeRef.current = virtualizer.getTotalSize();
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
      <div ref={sentinelRef} aria-hidden className="h-px w-full" />
      {isLoadingOlder && (
        <div className="flex justify-center py-2 text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
        </div>
      )}
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
