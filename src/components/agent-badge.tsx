import { Bot, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

export type AgentSlug = "alpha" | "vitor";
export type AgentBadgeSize = "sm" | "md";

type AgentPalette = {
  label: string;
  icon: LucideIcon;
  gradient: string;
  border: string;
  text: string;
  dot: string;
};

// Classes literais (sem interpolação) para o JIT do Tailwind v4 detectar.
const PALETTES: Record<AgentSlug, AgentPalette> = {
  alpha: {
    label: "Alpha",
    icon: Bot,
    gradient: "bg-gradient-to-br from-red-500 via-red-700 to-red-950",
    border: "border border-red-500/40",
    text: "text-white",
    dot: "bg-rose-200",
  },
  vitor: {
    label: "Vitor",
    icon: Bot,
    gradient: "bg-gradient-to-br from-amber-300 via-orange-500 to-orange-700",
    border: "border border-amber-300/40",
    text: "text-orange-50",
    dot: "bg-amber-100",
  },
};

const SIZING: Record<AgentBadgeSize, string> = {
  sm: "h-5 px-1.5 text-[10px] gap-1 rounded-md",
  md: "h-6 px-2 text-[11px] gap-1.5 rounded-md",
};

type AgentBadgeProps = {
  agent: AgentSlug;
  size?: AgentBadgeSize;
  withDot?: boolean;
  withIcon?: boolean;
  className?: string;
};

export function AgentBadge({
  agent,
  size = "md",
  withDot = false,
  withIcon = true,
  className,
}: AgentBadgeProps) {
  const palette = PALETTES[agent];
  const Icon = palette.icon;

  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center font-semibold uppercase tracking-[0.18em] whitespace-nowrap select-none",
        SIZING[size],
        palette.gradient,
        palette.border,
        palette.text,
        className,
      )}
    >
      {withIcon && <Icon className="h-3 w-3" />}
      {withDot && (
        <span
          aria-hidden="true"
          className={cn(
            "inline-block h-1.5 w-1.5 rounded-full animate-pulse",
            palette.dot,
          )}
        />
      )}
      <span>{palette.label}</span>
    </span>
  );
}
