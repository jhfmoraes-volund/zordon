"use client";

import { VitorIcon } from "@/components/icons/vitor-icon";

export function AIChatBubble({
  isOpen,
  isStreaming,
  onToggle,
}: {
  isOpen: boolean;
  isStreaming: boolean;
  onToggle: () => void;
}) {
  if (isOpen) return null;
  return (
    <div className="fixed bottom-6 right-6 z-50">
      <button
        type="button"
        onClick={onToggle}
        aria-label="Abrir Vitor"
        aria-pressed={isOpen}
        className={[
          "relative grid h-14 w-14 place-items-center rounded-2xl",
          "bg-[oklch(0.74_0.18_55)] text-white",
          "shadow-[0_8px_24px_-6px_oklch(0.74_0.18_55/0.55),0_0_0_1px_oklch(0.74_0.18_55/0.4)]",
          "transition-[transform,box-shadow] hover:scale-[1.03] active:scale-[0.97]",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[oklch(0.74_0.18_55)] focus-visible:ring-offset-2 focus-visible:ring-offset-background",
        ].join(" ")}
      >
        <VitorIcon className="h-7 w-7" strokeWidth={2.25} />
        {isStreaming && (
          <span className="absolute -top-1 -right-1 h-3 w-3 animate-pulse rounded-full bg-yellow-400 ring-2 ring-background" />
        )}
      </button>
    </div>
  );
}
