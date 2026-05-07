"use client";

import {
  type CSSProperties,
  forwardRef,
  useImperativeHandle,
  useRef,
} from "react";
import { ArrowUp, CheckSquare, Loader2, Square } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  AGENT_THEMES,
  type AgentId,
} from "@/components/ui/conversation/agent-themes";
import { cn } from "@/lib/utils";

export type ChatComposerHandle = {
  focus: () => void;
};

export type ChatComposerProps = {
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  placeholder?: string;
  isStreaming?: boolean;
  disabled?: boolean;
  /** Disable the submit button (e.g. when nothing typed AND no pending files). */
  submitDisabled?: boolean;
  /** Called when user clicks the stop icon (only visible while streaming). */
  onStop?: () => void;

  /** Selects accent color for focus ring + plan toggle accent. */
  agent?: AgentId;
  /** Mobile-friendly mode: enterkeyhint=send + 44px touch targets. */
  mobileMode?: boolean;

  /** When provided, renders a "Plan" toggle to the left of the submit button. */
  planMode?: boolean;
  onPlanModeChange?: (next: boolean) => void;

  /** Slot rendered ABOVE the textarea — used by pre-work for pending files / transcripts. */
  aboveSlot?: React.ReactNode;
  /** Slot rendered to the LEFT of the textarea (inside the bottom bar) — for icon actions like upload. */
  leftActions?: React.ReactNode;

  className?: string;
};

/**
 * Unified chat input for Vitor surfaces (lateral panel, pre-work, briefing).
 *
 * Layout (Replit-style): single rounded container with focus-within ring.
 * The textarea sits on top, a thin action bar lives at the bottom with
 * left actions (slot), the optional Plan toggle, and the submit/stop button.
 *
 * Plan toggle is controlled — pass `planMode` + `onPlanModeChange` to render it.
 * Persistence/cross-instance sync lives in `useChatPlanMode()`.
 */
export const ChatComposer = forwardRef<ChatComposerHandle, ChatComposerProps>(
  function ChatComposer(
    {
      value,
      onChange,
      onSubmit,
      placeholder = "Pergunte ou peça algo...",
      isStreaming,
      disabled,
      submitDisabled,
      onStop,
      agent = "alpha",
      mobileMode,
      planMode,
      onPlanModeChange,
      aboveSlot,
      leftActions,
      className,
    },
    ref,
  ) {
    const textareaRef = useRef<HTMLTextAreaElement>(null);

    useImperativeHandle(ref, () => ({
      focus: () => textareaRef.current?.focus({ preventScroll: true }),
    }));

    const showPlanToggle =
      planMode !== undefined && onPlanModeChange !== undefined;
    const canSubmit = !submitDisabled && !disabled && !isStreaming;
    const accent = AGENT_THEMES[agent].accent;
    const accentVar = { "--composer-accent": accent } as CSSProperties;
    const buttonSizeClass = mobileMode ? "h-11 w-11" : "h-8 w-8";
    const iconSizeClass = mobileMode ? "h-4 w-4" : "h-3.5 w-3.5";

    return (
      <div
        style={accentVar}
        className={cn(
          "rounded-2xl border border-border bg-muted/40 transition-colors",
          "focus-within:border-[color:var(--composer-accent)] focus-within:ring-2 focus-within:ring-[color:var(--composer-accent)]/20",
          disabled && "opacity-60",
          className,
        )}
      >
        {aboveSlot}

        <Textarea
          ref={textareaRef}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              if (canSubmit && value.trim()) {
                onSubmit();
              } else if (canSubmit) {
                // Allow submit even with empty value when caller permits
                // (e.g. pre-work when only pending files are attached).
                if (!submitDisabled) onSubmit();
              }
            }
          }}
          placeholder={placeholder}
          rows={1}
          disabled={disabled}
          enterKeyHint={mobileMode ? "send" : undefined}
          className={cn(
            "min-h-[44px] max-h-[160px] resize-none border-0 bg-transparent text-sm dark:bg-transparent",
            "shadow-none focus-visible:ring-0 focus-visible:ring-offset-0",
            "px-4 pt-3 pb-1.5",
          )}
        />

        <div className="flex items-center justify-between gap-2 px-2 pb-2">
          <div className="flex items-center gap-1">{leftActions}</div>

          <div className="flex items-center gap-1.5">
            {showPlanToggle && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => onPlanModeChange?.(!planMode)}
                disabled={disabled}
                aria-pressed={planMode}
                title={
                  planMode
                    ? "Plan ativo — Vitor planeja em texto e aguarda você executar"
                    : "Plan inativo — Vitor executa direto operações pequenas"
                }
                className={cn(
                  "h-8 gap-1.5 rounded-lg border border-border/60 bg-transparent px-2.5 text-xs font-medium",
                  "hover:bg-transparent",
                  planMode ? "text-foreground" : "text-muted-foreground hover:text-foreground",
                )}
              >
                {planMode ? (
                  <CheckSquare className="h-3.5 w-3.5" />
                ) : (
                  <Square className="h-3.5 w-3.5" />
                )}
                Plan
              </Button>
            )}

            {isStreaming && onStop ? (
              <Button
                type="button"
                size="icon"
                variant="ghost"
                onClick={onStop}
                aria-label="Parar"
                className={cn(
                  "shrink-0 animate-pulse rounded-lg bg-foreground/10 text-foreground hover:bg-foreground/20",
                  buttonSizeClass,
                )}
              >
                <Square className={iconSizeClass} />
              </Button>
            ) : (
              <Button
                type="button"
                size="icon"
                variant="ghost"
                onClick={onSubmit}
                disabled={!canSubmit || (submitDisabled ?? !value.trim())}
                aria-label="Enviar"
                className={cn(
                  "shrink-0 rounded-lg bg-foreground/10 text-foreground hover:bg-foreground/20 disabled:opacity-40",
                  buttonSizeClass,
                )}
              >
                {isStreaming ? (
                  <Loader2 className={cn("animate-spin", iconSizeClass)} />
                ) : (
                  <ArrowUp className={mobileMode ? "h-5 w-5" : "h-4 w-4"} />
                )}
              </Button>
            )}
          </div>
        </div>
      </div>
    );
  },
);
