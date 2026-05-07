"use client";

import { type CSSProperties } from "react";
import { Check, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { AGENT_THEMES, type AgentId } from "./agent-themes";
import { resolveToolMeta } from "./tool-registry";

export type ToolInvocationState = "partial-call" | "call" | "result";

type ToolCallChipProps = {
  agent: AgentId;
  toolName: string;
  args: Record<string, unknown>;
  state: ToolInvocationState;
};

export function ToolCallChip({
  agent,
  toolName,
  args,
  state,
}: ToolCallChipProps) {
  const theme = AGENT_THEMES[agent];
  const { label, icon: Icon } = resolveToolMeta(toolName, args);
  const phase: "queued" | "running" | "done" =
    state === "result" ? "done" : state === "call" ? "running" : "queued";

  const runningStyle: CSSProperties | undefined =
    phase === "running"
      ? {
          borderColor: theme.accent,
          background: theme.accentSoft,
          opacity: 0.95,
        }
      : undefined;

  return (
    <span
      data-phase={phase}
      style={runningStyle}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs transition-colors duration-200",
        "max-w-[280px] sm:max-w-none",
        phase === "queued" && "border-border/50 bg-transparent",
        phase === "done" && "border-border bg-muted/50",
      )}
      title={label}
    >
      {phase === "running" ? (
        <Loader2
          className="h-3 w-3 shrink-0 animate-spin"
          style={{ color: theme.accent }}
        />
      ) : phase === "done" ? (
        <Check className="h-3 w-3 shrink-0 text-green-500" />
      ) : (
        <Icon className="h-3 w-3 shrink-0 text-muted-foreground/60" />
      )}
      <span
        className={cn(
          "truncate",
          phase === "running" ? "shimmer-text font-medium" : "text-muted-foreground",
        )}
      >
        {label}
      </span>
    </span>
  );
}
