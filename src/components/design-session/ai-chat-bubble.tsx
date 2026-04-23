"use client";

import { MessageCircle, X } from "lucide-react";
import { Button } from "@/components/ui/button";

export function AIChatBubble({
  isOpen,
  isStreaming,
  onToggle,
}: {
  isOpen: boolean;
  isStreaming: boolean;
  onToggle: () => void;
}) {
  return (
    <div className="fixed bottom-6 right-6 z-50">
      <Button
        onClick={onToggle}
        size="icon"
        className="h-14 w-14 rounded-full shadow-lg"
      >
        {isOpen ? (
          <X className="h-6 w-6" />
        ) : (
          <div className="relative">
            <MessageCircle className="h-6 w-6" />
            {isStreaming && (
              <span className="absolute -top-1 -right-1 h-3 w-3 rounded-full bg-yellow-400 animate-pulse" />
            )}
          </div>
        )}
      </Button>
    </div>
  );
}
