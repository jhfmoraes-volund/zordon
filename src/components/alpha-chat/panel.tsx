"use client";

import { useState } from "react";
import Link from "next/link";
import { History, Maximize2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ConversationPanel } from "@/components/ui/conversation";
import { cn } from "@/lib/utils";
import { useIsMobile } from "@/hooks/use-mobile";
import { useAlphaChat } from "./store";
import { useAlphaKeyboard } from "./use-alpha-keyboard";

/**
 * Renders the Alpha conversation in two shapes that share <ConversationPanel>:
 *
 * - **Desktop**: right column flex sibling of <main>. Animates from w-0 to w-96
 *   via transition-[width]. Inner div has w-96 fixed so the content doesn't
 *   reflow during the transition (just gets clipped by the outer overflow-hidden).
 *
 * - **Mobile**: Sheet bottom 90dvh — handled by `<ConversationPanel variant="mobile">`.
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
    status,
    isLoading,
    sendMessage,
    setHistoryOpen,
  } = useAlphaChat();
  const isMobile = useIsMobile();
  const [input, setInput] = useState("");

  useAlphaKeyboard();

  if (!enabled) return null;

  const handleSend = () => {
    if (!input.trim() || isLoading) return;
    sendMessage(input);
    setInput("");
  };

  const headerSlot = (
    <>
      <Button
        nativeButton={false}
        render={<Link href="/ops" onClick={() => setOpen(false)} />}
        variant="ghost"
        size="icon"
        className="size-7"
        aria-label="Abrir página completa"
        title="Abrir página completa"
      >
        <Maximize2 className="size-3.5" />
      </Button>
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
    </>
  );

  const sharedProps = {
    agent: "alpha" as const,
    messages,
    status,
    input,
    onInputChange: setInput,
    onSubmit: handleSend,
    headerSlot,
    placeholder: "Pergunte ao Alpha...",
  };

  if (isMobile) {
    return (
      <ConversationPanel
        {...sharedProps}
        variant="mobile"
        isOpen={isOpen}
        onOpenChange={setOpen}
        onClose={() => setOpen(false)}
      />
    );
  }

  return (
    <aside
      aria-hidden={!isOpen}
      className={cn(
        "z-20 shrink-0 overflow-hidden border-l border-border/50 bg-background transition-[width] duration-300 ease-in-out",
        isOpen ? "w-96" : "w-0",
      )}
    >
      <div className="flex h-full w-96 flex-col">
        <ConversationPanel
          {...sharedProps}
          variant="desktop"
          autoFocus={isOpen}
          onClose={() => setOpen(false)}
          className="rounded-none border-0 shadow-none"
        />
      </div>
    </aside>
  );
}
