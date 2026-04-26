"use client";

import { Bot, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useAlphaChat } from "./store";

/**
 * Botão Bot que vive no header. Toggle do panel/sheet.
 * Visual: ícone vermelho vivo (`--primary`) com glow leve estático ao redor.
 * Sem animação — o glow é constante. Estado `isOpen` adiciona bg + ring.
 *
 * Atalho: ⌘⇧A (registrado em useAlphaKeyboard).
 */
export function AlphaChatTrigger() {
  const { enabled, isOpen, toggle } = useAlphaChat();
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
            className={cn(
              "relative size-9 shrink-0 text-primary",
              "shadow-[0_0_8px_-1px] shadow-primary/40",
              "hover:text-primary hover:bg-primary/10",
              "data-[active=true]:bg-primary/10 data-[active=true]:ring-1 data-[active=true]:ring-primary/40",
            )}
          >
            {isOpen ? <X className="size-4" /> : <Bot className="size-4" />}
          </Button>
        }
      />
      <TooltipContent side="bottom">
        {isOpen ? "Fechar Alpha" : "Alpha · ⌘⇧A"}
      </TooltipContent>
    </Tooltip>
  );
}
