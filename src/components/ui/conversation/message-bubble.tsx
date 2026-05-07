"use client";

import { memo } from "react";
import type { UIMessage } from "@ai-sdk/react";
import { cn } from "@/lib/utils";
import { Markdown } from "@/components/ui/markdown";
import { AGENT_THEMES, type AgentId } from "./agent-themes";
import { AgentBadge } from "./agent-badge";
import { ToolCallChip } from "./tool-call-chip";
import { ToolCallSummary } from "./tool-call-summary";
import {
  extractText,
  extractToolParts,
  serializeToolStates,
} from "./message-utils";

type Props = {
  agent: AgentId;
  message: UIMessage;
  showAgentBadge?: boolean;
};

export const MessageBubble = memo(
  function MessageBubble({ agent, message, showAgentBadge = true }: Props) {
    const isUser = message.role === "user";
    const text = extractText(message);
    const toolParts = extractToolParts(message);
    const doneCount = toolParts.filter((p) => p.state === "result").length;
    const threshold = AGENT_THEMES[agent].collapseThreshold;
    const shouldCollapse = doneCount >= threshold;

    return (
      <div className={cn("flex", isUser ? "justify-end" : "justify-start")}>
        <div className="min-w-0 max-w-[85%] space-y-2">
          {!isUser && showAgentBadge && <AgentBadge agent={agent} size="sm" />}

          {text && (
            <div
              className={cn(
                "overflow-hidden break-words rounded-2xl text-sm",
                isUser
                  ? "rounded-tr-sm bg-primary px-3 py-2 text-primary-foreground"
                  : "rounded-tl-sm bg-muted px-4 py-3",
              )}
            >
              <Markdown maxChars={10000}>{text}</Markdown>
            </div>
          )}

          {toolParts.length > 0 && !shouldCollapse && (
            <div className="flex flex-wrap gap-1.5">
              {toolParts.map((p) => (
                <ToolCallChip
                  key={p.toolCallId}
                  agent={agent}
                  toolName={p.toolName}
                  args={p.args}
                  state={p.state}
                />
              ))}
            </div>
          )}

          {toolParts.length > 0 && shouldCollapse && (
            <ToolCallSummary agent={agent} parts={toolParts} />
          )}
        </div>
      </div>
    );
  },
  (prev, next) =>
    prev.agent === next.agent &&
    prev.showAgentBadge === next.showAgentBadge &&
    prev.message.id === next.message.id &&
    extractText(prev.message) === extractText(next.message) &&
    serializeToolStates(prev.message) === serializeToolStates(next.message),
);
