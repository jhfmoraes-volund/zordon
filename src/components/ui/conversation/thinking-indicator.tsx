import { Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";

type Props = {
  label?: string;
  className?: string;
};

export function ThinkingIndicator({ label = "Analisando...", className }: Props) {
  return (
    <div
      className={cn(
        "flex items-center gap-2 px-1 py-2 text-muted-foreground",
        className,
      )}
      aria-live="polite"
    >
      <Sparkles className="h-3.5 w-3.5 animate-pulse" />
      <span className="shimmer-text text-xs">{label}</span>
    </div>
  );
}
