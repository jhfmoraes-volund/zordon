"use client";

import { cn } from "@/lib/utils";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { AgentBadge } from "@/components/ui/conversation";
import { useAlphaChat } from "./store";

/**
 * Header button that opens the Alpha panel/sheet.
 * Visual is the shared <AgentBadge agent="alpha" />; wrapper handles click,
 * focus, and the `isOpen` state (active ring on the tile).
 *
 * Shortcut: ⌘⇧A (registered in useAlphaKeyboard).
 */
export function AlphaChatTrigger() {
  const { enabled, isOpen, toggle } = useAlphaChat();
  if (!enabled) return null;

  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <button
            type="button"
            onClick={toggle}
            data-active={isOpen}
            aria-label={isOpen ? "Fechar Alpha" : "Abrir Alpha"}
            aria-pressed={isOpen}
            className={cn(
              "shrink-0 rounded-md transition-[opacity,box-shadow,transform]",
              "hover:opacity-90 active:scale-[0.98]",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 focus-visible:ring-offset-2 focus-visible:ring-offset-background",
              "data-[active=true]:ring-1 data-[active=true]:ring-primary/60 data-[active=true]:ring-offset-2 data-[active=true]:ring-offset-background",
            )}
          >
            <AgentBadge agent="alpha" size="sm" />
          </button>
        }
      />
      <TooltipContent side="bottom">
        {isOpen ? "Fechar Alpha" : "Alpha · ⌘⇧A"}
      </TooltipContent>
    </Tooltip>
  );
}
