"use client";

import { Button } from "@/components/ui/button";
import { MessageCircle, X } from "lucide-react";
import { useAlphaChat } from "./store";

type Variant = "header" | "floating";

/**
 * Two render targets:
 * - "header"   — small button rendered inside the dashboard header. Visible
 *                only on mobile (md:hidden via parent classes).
 * - "floating" — the classic 56px bubble fixed to bottom-right. Visible only
 *                on desktop (hidden md:block via parent classes).
 *
 * Both call the same toggle() from the AlphaChatProvider, so state is shared.
 */
export function AlphaChatTrigger({ variant }: { variant: Variant }) {
  const { enabled, isOpen, toggle, isLoading } = useAlphaChat();
  if (!enabled) return null;

  if (variant === "header") {
    return (
      <Button
        onClick={toggle}
        size="icon"
        variant={isOpen ? "secondary" : "ghost"}
        className="h-9 w-9 shrink-0"
        aria-label={isOpen ? "Fechar Alpha" : "Abrir Alpha"}
      >
        {isOpen ? (
          <X className="h-4 w-4" />
        ) : (
          <div className="relative">
            <MessageCircle className="h-4 w-4" />
            {isLoading && (
              <span className="absolute -top-0.5 -right-0.5 h-2 w-2 rounded-full bg-yellow-400 animate-pulse" />
            )}
          </div>
        )}
      </Button>
    );
  }

  return (
    <div
      className="fixed right-6 z-50"
      style={{ bottom: "calc(1.5rem + env(safe-area-inset-bottom))" }}
    >
      <Button
        onClick={toggle}
        size="icon"
        className="h-14 w-14 rounded-full shadow-lg"
        aria-label={isOpen ? "Fechar Alpha" : "Abrir Alpha"}
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
}
