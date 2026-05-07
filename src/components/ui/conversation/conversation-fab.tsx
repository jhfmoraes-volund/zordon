"use client";

import { type CSSProperties } from "react";
import { cn } from "@/lib/utils";
import { AGENT_THEMES, type AgentId } from "./agent-themes";

type Props = {
  agent: AgentId;
  isOpen: boolean;
  isStreaming?: boolean;
  onClick: () => void;
  position?: "bottom-right" | "bottom-left";
  ariaLabel?: string;
  className?: string;
};

const PALETTE: Record<AgentId, string> = {
  alpha: "0.637 0.237 22",
  vitor: "0.74 0.18 55",
};

export function ConversationFab({
  agent,
  isOpen,
  isStreaming,
  onClick,
  position = "bottom-right",
  ariaLabel,
  className,
}: Props) {
  if (isOpen) return null;
  const theme = AGENT_THEMES[agent];
  const Icon = theme.icon;
  const raw = PALETTE[agent];
  const buttonStyle: CSSProperties = {
    backgroundColor: `oklch(${raw})`,
    boxShadow: `0 8px 24px -6px oklch(${raw} / 0.55), 0 0 0 1px oklch(${raw} / 0.4)`,
  };

  return (
    <div
      className={cn(
        "fixed z-50",
        position === "bottom-right" ? "bottom-6 right-6" : "bottom-6 left-6",
        "pb-safe",
        className,
      )}
    >
      <button
        type="button"
        onClick={onClick}
        aria-label={ariaLabel ?? `Abrir ${theme.label}`}
        aria-pressed={isOpen}
        style={buttonStyle}
        className={cn(
          "relative grid h-14 w-14 place-items-center rounded-2xl text-white",
          "transition-[transform,box-shadow] hover:scale-[1.03] active:scale-[0.97]",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-background",
        )}
      >
        <Icon size={28} strokeWidth={2.25} />
        {isStreaming && (
          <span
            className="absolute -right-1 -top-1 h-3 w-3 animate-pulse rounded-full bg-yellow-400 ring-2 ring-background"
            aria-hidden
          />
        )}
      </button>
    </div>
  );
}
