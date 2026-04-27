import { type HTMLAttributes, forwardRef } from "react";
import { cn } from "@/lib/utils";
import { VitorIcon } from "@/components/icons/vitor-icon";

type VitorBadgeProps = HTMLAttributes<HTMLSpanElement> & {
  size?: "sm" | "md";
  showDot?: boolean;
  label?: string;
};

/**
 * Vitor Badge — Scan HUD (low glow), variante laranja tropical.
 * Mesma estrutura do AlphaBadge: tile com glifo + label "VITOR".
 */
export const VitorBadge = forwardRef<HTMLSpanElement, VitorBadgeProps>(
  (
    { size = "md", showDot = true, label = "Vitor", className, ...props },
    ref,
  ) => {
    const isSm = size === "sm";

    return (
      <span
        ref={ref}
        className={cn(
          "inline-flex items-stretch overflow-hidden rounded-md",
          "bg-[oklch(0.10_0_0)]",
          "shadow-[inset_0_0_0_1px_oklch(0.74_0.18_55/0.30),0_0_14px_-4px_oklch(0.74_0.18_55/0.22)]",
          isSm ? "h-8" : "h-11",
          className,
        )}
        {...props}
      >
        <span
          aria-hidden
          className={cn(
            "flex flex-none items-center justify-center text-[oklch(0.74_0.18_55)]",
            "shadow-[inset_-1px_0_0_oklch(0.74_0.18_55/0.30)]",
            "bg-[linear-gradient(180deg,oklch(0.16_0.06_55/0.5),oklch(0.10_0_0)),repeating-linear-gradient(0deg,transparent_0_3px,oklch(0.74_0.18_55/0.05)_3px_4px)]",
            isSm ? "w-8" : "w-11",
          )}
        >
          <VitorIcon size={isSm ? 16 : 22} />
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
                "rounded-full bg-[oklch(0.74_0.18_55)]",
                "shadow-[0_0_6px_oklch(0.74_0.18_55/0.7)]",
                isSm ? "h-1 w-1" : "h-[5px] w-[5px]",
              )}
            />
          )}
          {label}
        </span>
      </span>
    );
  },
);

VitorBadge.displayName = "VitorBadge";
