import { type CSSProperties, type HTMLAttributes, forwardRef } from "react";
import { cn } from "@/lib/utils";
import { AGENT_THEMES, type AgentId } from "./agent-themes";

type AgentBadgeProps = HTMLAttributes<HTMLSpanElement> & {
  agent: AgentId;
  size?: "sm" | "md";
  showDot?: boolean;
  label?: string;
};

const PALETTE: Record<AgentId, { accentRaw: string; tileBgRaw: string }> = {
  alpha: {
    accentRaw: "0.637 0.237 22",
    tileBgRaw: "0.16 0.06 22",
  },
  vitor: {
    accentRaw: "0.74 0.18 55",
    tileBgRaw: "0.16 0.06 55",
  },
};

export const AgentBadge = forwardRef<HTMLSpanElement, AgentBadgeProps>(
  function AgentBadge(
    { agent, size = "md", showDot = true, label, className, style, ...props },
    ref,
  ) {
    const theme = AGENT_THEMES[agent];
    const Icon = theme.icon;
    const isSm = size === "sm";
    const { accentRaw, tileBgRaw } = PALETTE[agent];
    const accent = `oklch(${accentRaw})`;
    const tileBgPrimary = `oklch(${tileBgRaw}/0.5)`;
    const tileBgScanline = `oklch(${accentRaw}/0.05)`;
    const ringInset = `oklch(${accentRaw}/0.30)`;
    const ringHalo = `oklch(${accentRaw}/0.22)`;
    const dotShadow = `oklch(${accentRaw}/0.7)`;

    const composedStyle: CSSProperties = {
      backgroundColor: "oklch(0.10 0 0)",
      boxShadow: `inset 0 0 0 1px ${ringInset}, 0 0 14px -4px ${ringHalo}`,
      ...style,
    };

    return (
      <span
        ref={ref}
        className={cn(
          "inline-flex items-stretch overflow-hidden rounded-md",
          isSm ? "h-8" : "h-11",
          className,
        )}
        style={composedStyle}
        {...props}
      >
        <span
          aria-hidden
          className={cn(
            "flex flex-none items-center justify-center",
            isSm ? "w-8" : "w-11",
          )}
          style={{
            color: accent,
            boxShadow: `inset -1px 0 0 ${ringInset}`,
            backgroundImage: `linear-gradient(180deg, ${tileBgPrimary}, oklch(0.10 0 0)), repeating-linear-gradient(0deg, transparent 0 3px, ${tileBgScanline} 3px 4px)`,
          }}
        >
          <Icon size={isSm ? 16 : 22} />
        </span>

        <span
          className={cn(
            "inline-flex items-center gap-2 font-mono font-semibold uppercase",
            "text-foreground/95",
            isSm
              ? "px-3 pl-2.5 text-[10.5px] tracking-[0.16em]"
              : "px-4 pl-3.5 text-xs tracking-[0.18em]",
          )}
        >
          {showDot && (
            <span
              aria-hidden
              className={cn(
                "rounded-full",
                isSm ? "h-1 w-1" : "h-[5px] w-[5px]",
              )}
              style={{
                backgroundColor: accent,
                boxShadow: `0 0 6px ${dotShadow}`,
              }}
            />
          )}
          {label ?? theme.label}
        </span>
      </span>
    );
  },
);

AgentBadge.displayName = "AgentBadge";
