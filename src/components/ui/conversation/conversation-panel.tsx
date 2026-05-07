"use client";

import { type ReactNode, useEffect, useRef } from "react";
import type { UIMessage } from "@ai-sdk/react";
import { Play, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  ChatComposer,
  type ChatComposerHandle,
} from "@/components/ui/chat-composer";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import { AGENT_THEMES, type AgentId } from "./agent-themes";
import { AgentBadge } from "./agent-badge";
import { MessageList, type MessageListStatus } from "./message-list";

export type ConversationVariant = "desktop" | "mobile" | "fullpage";

export type ConversationPanelProps = {
  agent: AgentId;
  variant: ConversationVariant;
  messages: UIMessage[];
  status: MessageListStatus;
  input: string;
  onInputChange: (value: string) => void;
  onSubmit: () => void;
  onStop?: () => void;

  isOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  onClose?: () => void;

  planMode?: boolean;
  onPlanModeChange?: (next: boolean) => void;
  onExecutePlan?: () => void;

  placeholder?: string;
  emptyState?: ReactNode;
  headerSlot?: ReactNode;
  composerLeftActions?: ReactNode;
  composerAboveSlot?: ReactNode;

  composerSubmitDisabled?: boolean;
  /** Auto-focus composer on mount (defaults: desktop=true, mobile only when open). */
  autoFocus?: boolean;

  /** When true, MessageList auto-loads older history on scroll-to-top. */
  hasOlder?: boolean;
  isLoadingOlder?: boolean;
  onLoadOlder?: () => void;

  className?: string;
};

function ExecutePlanButton({ onClick }: { onClick: () => void }) {
  return (
    <Button
      type="button"
      size="sm"
      onClick={onClick}
      className="mt-2 gap-1.5"
    >
      <Play className="h-3.5 w-3.5" />
      Executar plano
    </Button>
  );
}

function shouldShowExecuteButton(opts: {
  planMode: boolean | undefined;
  status: MessageListStatus;
  messages: UIMessage[];
  msgIdx: number;
}): boolean {
  if (!opts.planMode) return false;
  if (opts.status === "streaming" || opts.status === "submitted") return false;
  if (opts.msgIdx !== opts.messages.length - 1) return false;
  const msg = opts.messages[opts.msgIdx];
  if (!msg || msg.role !== "assistant") return false;
  const hasToolCall =
    msg.parts?.some(
      (p) => p.type === "tool-invocation" || p.type.startsWith("tool-"),
    ) ?? false;
  return !hasToolCall;
}

function PanelBody({
  agent,
  variant,
  messages,
  status,
  input,
  onInputChange,
  onSubmit,
  onStop,
  onClose,
  planMode,
  onPlanModeChange,
  onExecutePlan,
  placeholder,
  emptyState,
  headerSlot,
  composerLeftActions,
  composerAboveSlot,
  composerSubmitDisabled,
  autoFocus,
  hasOlder,
  isLoadingOlder,
  onLoadOlder,
}: Omit<ConversationPanelProps, "isOpen" | "onOpenChange" | "className">) {
  const composerRef = useRef<ChatComposerHandle>(null);
  const theme = AGENT_THEMES[agent];
  const isMobile = variant === "mobile";

  useEffect(() => {
    if (!autoFocus) return;
    const t = setTimeout(() => composerRef.current?.focus(), 100);
    return () => clearTimeout(t);
  }, [autoFocus]);

  const renderAfterMessage = onExecutePlan
    ? (msg: UIMessage, idx: number) => {
        if (
          shouldShowExecuteButton({
            planMode,
            status,
            messages,
            msgIdx: idx,
          })
        ) {
          return <ExecutePlanButton onClick={onExecutePlan} />;
        }
        return null;
      }
    : undefined;

  const defaultEmpty = (
    <div className="flex flex-col items-center justify-center text-center text-muted-foreground">
      <theme.icon
        size={40}
        className="mb-3"
        style={{ color: theme.accent, opacity: 0.4 }}
      />
      <p className="text-sm font-medium">Como posso ajudar?</p>
      <p className="mt-1 max-w-[260px] text-xs">{theme.emptyHint}</p>
    </div>
  );

  return (
    <>
      {(headerSlot || onClose) && (
        <div className="flex h-12 shrink-0 items-center justify-between border-b border-border/50 bg-muted/30 px-4">
          <AgentBadge agent={agent} size="sm" />
          <div className="flex items-center gap-2">
            {headerSlot}
            {onClose && (
              <Button
                variant="ghost"
                size="icon"
                className="size-7"
                onClick={onClose}
                aria-label="Fechar assistente"
              >
                <X className="size-3.5" />
              </Button>
            )}
          </div>
        </div>
      )}

      <MessageList
        agent={agent}
        messages={messages}
        status={status}
        emptyState={emptyState ?? defaultEmpty}
        renderAfterMessage={renderAfterMessage}
        hasOlder={hasOlder}
        isLoadingOlder={isLoadingOlder}
        onLoadOlder={onLoadOlder}
      />

      <div
        className={cn(
          "shrink-0 border-t border-border/50 p-3",
          isMobile && "pb-safe",
        )}
      >
        <ChatComposer
          ref={composerRef}
          agent={agent}
          mobileMode={isMobile}
          value={input}
          onChange={onInputChange}
          onSubmit={onSubmit}
          isStreaming={status === "streaming" || status === "submitted"}
          onStop={onStop}
          submitDisabled={composerSubmitDisabled}
          planMode={planMode}
          onPlanModeChange={onPlanModeChange}
          aboveSlot={composerAboveSlot}
          leftActions={composerLeftActions}
          placeholder={placeholder ?? "Pergunte ou peça algo..."}
        />
      </div>
    </>
  );
}

export function ConversationPanel(props: ConversationPanelProps) {
  const {
    variant,
    isOpen,
    onOpenChange,
    className,
    autoFocus,
    ...rest
  } = props;

  if (variant === "mobile") {
    return (
      <Sheet open={Boolean(isOpen)} onOpenChange={onOpenChange}>
        <SheetContent
          side="bottom"
          showCloseButton={false}
          className={cn(
            "flex w-full max-w-full flex-col gap-0 rounded-t-xl p-0 data-[side=bottom]:h-[90dvh] sm:max-w-full",
            className,
          )}
        >
          <SheetTitle className="sr-only">Conversa</SheetTitle>
          <PanelBody
            {...rest}
            variant="mobile"
            autoFocus={autoFocus ?? Boolean(isOpen)}
          />
        </SheetContent>
      </Sheet>
    );
  }

  if (variant === "fullpage") {
    return (
      <div
        className={cn(
          "mx-auto flex h-full w-full max-w-3xl flex-col overflow-hidden",
          className,
        )}
      >
        <PanelBody
          {...rest}
          variant="fullpage"
          autoFocus={autoFocus ?? true}
        />
      </div>
    );
  }

  return (
    <aside
      className={cn(
        "flex h-full w-full flex-col overflow-hidden rounded-2xl border bg-background shadow-sm",
        className,
      )}
    >
      <PanelBody
        {...rest}
        variant="desktop"
        autoFocus={autoFocus ?? true}
      />
    </aside>
  );
}
