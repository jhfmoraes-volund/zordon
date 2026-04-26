"use client";

import { useDesignSessionChat } from "@/hooks/use-design-session-chat";
import { useDesignSession } from "@/contexts/design-session-context";
import { AIChatBubble } from "./ai-chat-bubble";
import { AIChatPanel } from "./ai-chat-panel";
import { getSteps } from "@/lib/design-session-steps";

/**
 * Orchestrator component that wires the chat hook to the bubble + panel.
 * Rendered inside WizardLayout, reads context from DesignSessionProvider.
 */
export function AIChat() {
  const ctx = useDesignSession();
  const chat = useDesignSessionChat();

  const steps = getSteps(ctx.sessionType);
  const currentStep = steps[ctx.currentStepIndex];
  const stepTitle = currentStep?.title || ctx.currentStepKey;

  return (
    <>
      <AIChatBubble
        isOpen={chat.isOpen}
        isStreaming={chat.status === "streaming"}
        onToggle={chat.toggle}
      />
      <AIChatPanel
        isOpen={chat.isOpen}
        messages={chat.messages}
        input={chat.input}
        isLoading={chat.status === "streaming" || chat.status === "submitted"}
        currentStepTitle={stepTitle}
        onInputChange={chat.setInput}
        onSubmit={(e) => {
          e.preventDefault();
          chat.sendMessage(chat.input);
        }}
        onOpenChange={(open) => {
          if (open !== chat.isOpen) chat.toggle();
        }}
      />
    </>
  );
}
