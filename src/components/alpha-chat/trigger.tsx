"use client";

import { Bot, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useAlphaChat } from "./store";

/**
 * Botão Bot que vive no header (mobile + desktop). Toggle do panel/sheet.
 * Estado ativo (isOpen) usa primary color; loading mostra dot pulsando.
 *
 * Atalho: ⌘⇧A / Ctrl+Shift+A (registrado em useAlphaKeyboard).
 */
export function AlphaChatTrigger() {
  const { enabled, isOpen, toggle, isLoading } = useAlphaChat();
  if (!enabled) return null;

  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            onClick={toggle}
            size="icon"
            variant="ghost"
            data-active={isOpen}
            aria-label={isOpen ? "Fechar Alpha" : "Abrir Alpha"}
            className="relative size-9 shrink-0 data-[active=true]:bg-primary/10 data-[active=true]:text-primary data-[active=true]:ring-1 data-[active=true]:ring-primary/30"
          >
            {isOpen ? <X className="size-4" /> : <Bot className="size-4" />}
            {isLoading && !isOpen && (
              <span className="absolute right-1.5 top-1.5 size-2 animate-pulse rounded-full bg-yellow-400" />
            )}
          </Button>
        }
      />
      <TooltipContent side="bottom">
        {isOpen ? "Fechar Alpha" : "Alpha · ⌘⇧A"}
      </TooltipContent>
    </Tooltip>
  );
}
