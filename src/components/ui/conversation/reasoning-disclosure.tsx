"use client";

import { useState } from "react";
import { ChevronRight, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";
import { Markdown } from "@/components/ui/markdown";

type Props = {
  /** Raciocínio acumulado (thinking nativo). */
  text: string;
  /** True enquanto o bloco de thinking ainda está chegando. */
  streaming: boolean;
  /** True quando a resposta (texto PT) já começou a aparecer. */
  hasAnswer: boolean;
};

/**
 * Bloco colapsável do raciocínio do agente (thinking nativo).
 *
 * UX: enquanto o agente pensa e a resposta ainda não chegou, fica
 * auto-expandido com header "Pensando…" (shimmer) e o raciocínio streamando.
 * Assim que a resposta em português começa, colapsa sozinho num chip
 * "Raciocínio" — o João pode reabrir clicando. Toggle manual sobrepõe o auto.
 */
export function ReasoningDisclosure({ text, streaming, hasAnswer }: Props) {
  const [userOpen, setUserOpen] = useState<boolean | null>(null);
  if (!text) return null;

  // Auto-expande durante o pensamento vivo; colapsa quando a resposta chega.
  const auto = streaming && !hasAnswer;
  const open = userOpen ?? auto;
  const label = streaming && !hasAnswer ? "Pensando…" : "Raciocínio";

  return (
    <div className="flex flex-col gap-1.5">
      <button
        type="button"
        onClick={() => setUserOpen((v) => (v === null ? !auto : !v))}
        aria-expanded={open}
        className={cn(
          "inline-flex h-8 items-center gap-1.5 self-start rounded-md px-2 text-xs",
          "text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground",
        )}
      >
        <Sparkles
          className={cn("h-3.5 w-3.5", streaming && !hasAnswer && "animate-pulse")}
        />
        <span className={cn(streaming && !hasAnswer && "shimmer-text")}>
          {label}
        </span>
        <ChevronRight
          className={cn(
            "h-3.5 w-3.5 transition-transform duration-150",
            open && "rotate-90",
          )}
        />
      </button>
      {open && (
        <div className="rounded-xl border border-border/60 bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
          <Markdown maxChars={8000}>{text}</Markdown>
        </div>
      )}
    </div>
  );
}
