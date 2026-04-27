import { Bot, Lightbulb, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

export type AgentSlug = "alpha" | "vitor";
export type AgentBadgeVariant = "pill" | "block";
export type AgentBadgeSize = "sm" | "md";

type PaletteStyle = {
  gradient: string;
  border: string;
  glow: string;
  text: string;
  dot: string;
};

type AgentPalette = {
  label: string;
  icon: LucideIcon;
  pill: PaletteStyle;
  block: PaletteStyle;
};

// Classes literais (sem interpolação) para o JIT do Tailwind v4 detectar.
const PALETTES: Record<AgentSlug, AgentPalette> = {
  alpha: {
    label: "Alpha",
    icon: Bot,
    pill: {
      gradient: "bg-gradient-to-r from-rose-500 via-red-700 to-red-900",
      border: "border border-red-400/30",
      glow: "shadow-[0_0_18px_-4px_rgba(244,63,94,0.55)]",
      text: "text-white",
      dot: "bg-rose-200 shadow-[0_0_8px_rgba(244,63,94,0.95)]",
    },
    block: {
      gradient: "bg-gradient-to-br from-red-500 via-red-700 to-red-950",
      border: "border border-red-500/40",
      glow: "shadow-[0_0_22px_-2px_rgba(220,38,38,0.55)]",
      text: "text-white drop-shadow-[0_0_6px_rgba(255,80,80,0.45)]",
      dot: "bg-rose-200 shadow-[0_0_8px_rgba(244,63,94,0.95)]",
    },
  },
  vitor: {
    label: "Vitor",
    icon: Lightbulb,
    pill: {
      gradient: "bg-gradient-to-r from-amber-300 via-orange-500 to-orange-600",
      border: "border border-amber-300/40",
      glow: "shadow-[0_0_18px_-4px_rgba(251,146,60,0.55)]",
      text: "text-orange-50",
      dot: "bg-amber-100 shadow-[0_0_8px_rgba(251,191,36,0.95)]",
    },
    block: {
      gradient: "bg-gradient-to-br from-amber-300 via-orange-500 to-orange-700",
      border: "border border-amber-300/40",
      glow: "shadow-[0_0_22px_-2px_rgba(251,146,60,0.55)]",
      text: "text-orange-50 drop-shadow-[0_0_6px_rgba(255,180,80,0.45)]",
      dot: "bg-amber-100 shadow-[0_0_8px_rgba(251,191,36,0.95)]",
    },
  },
};

const SIZING: Record<AgentBadgeVariant, Record<AgentBadgeSize, string>> = {
  pill: {
    sm: "h-5 px-2 text-[10px] gap-1 rounded-full",
    md: "h-6 px-2.5 text-[11px] gap-1.5 rounded-full",
  },
  block: {
    sm: "h-5 px-1.5 text-[10px] gap-1 rounded-md",
    md: "h-6 px-2 text-[11px] gap-1.5 rounded-md",
  },
};

type AgentBadgeProps = {
  agent: AgentSlug;
  variant?: AgentBadgeVariant;
  size?: AgentBadgeSize;
  withDot?: boolean;
  withIcon?: boolean;
  className?: string;
};

export function AgentBadge({
  agent,
  variant = "pill",
  size = "md",
  withDot = true,
  withIcon = false,
  className,
}: AgentBadgeProps) {
  const palette = PALETTES[agent];
  const styles = palette[variant];
  const Icon = palette.icon;

  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center font-semibold uppercase tracking-[0.18em] whitespace-nowrap select-none",
        SIZING[variant][size],
        styles.gradient,
        styles.border,
        styles.glow,
        styles.text,
        className,
      )}
    >
      {withIcon && <Icon className="h-3 w-3" />}
      {withDot && (
        <span
          aria-hidden="true"
          className={cn(
            "inline-block h-1.5 w-1.5 rounded-full animate-pulse",
            styles.dot,
          )}
        />
      )}
      <span>{palette.label}</span>
    </span>
  );
}
