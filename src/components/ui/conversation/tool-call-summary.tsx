"use client";

import { useState } from "react";
import { ChevronRight, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { AGENT_THEMES, type AgentId } from "./agent-themes";
import { ToolCallChip, type ToolInvocationState } from "./tool-call-chip";

export type ToolPart = {
  toolCallId: string;
  toolName: string;
  args: Record<string, unknown>;
  state: ToolInvocationState;
};

type Props = {
  agent: AgentId;
  parts: ToolPart[];
  defaultOpen?: boolean;
};

export function ToolCallSummary({ agent, parts, defaultOpen = false }: Props) {
  const [open, setOpen] = useState(defaultOpen);
  if (parts.length === 0) return null;

  // Algum tool ainda rodando → o header continua "vivo" (spinner + shimmer)
  // em vez de já anunciar "Aplicou N alterações" como se tivesse terminado.
  const running = parts.some((p) => p.state !== "result");
  const accent = AGENT_THEMES[agent].accent;

  return (
    <div className="flex flex-col gap-1.5">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className={cn(
          "inline-flex h-8 items-center gap-1.5 self-start rounded-md px-2 text-xs",
          "text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground",
        )}
      >
        {running ? (
          <Loader2
            className="h-3.5 w-3.5 shrink-0 animate-spin"
            style={{ color: accent }}
          />
        ) : (
          <ChevronRight
            className={cn(
              "h-3.5 w-3.5 transition-transform duration-150",
              open && "rotate-90",
            )}
          />
        )}
        {running ? (
          <span className="shimmer-text">
            Executando {parts.length}{" "}
            {parts.length === 1 ? "ação" : "ações"}…
          </span>
        ) : (
          <>
            Aplicou {parts.length}{" "}
            {parts.length === 1 ? "alteração" : "alterações"}
          </>
        )}
      </button>
      {open && (
        <div className="flex flex-wrap gap-1.5">
          {parts.map((p) => (
            <ToolCallChip
              key={p.toolCallId}
              agent={agent}
              toolName={p.toolName}
              args={p.args}
              state={p.state}
            />
          ))}
        </div>
      )}
    </div>
  );
}
