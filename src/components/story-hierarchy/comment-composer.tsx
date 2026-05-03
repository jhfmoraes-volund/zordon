"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import {
  buildMentionableMembers,
  type MentionMember,
  type MentionableMember,
} from "@/lib/mentions";

type Props = {
  members: MentionMember[];
  onSubmit: (body: string) => Promise<void> | void;
  placeholder?: string;
  disabled?: boolean;
  /** Initial value for edit mode. Empty for create. */
  initialValue?: string;
  /** Submit button label. Defaults to "Enviar". */
  submitLabel?: string;
  /** Called when the user hits Esc — useful for closing inline edit. */
  onCancel?: () => void;
  autoFocus?: boolean;
};

type MentionState = {
  open: boolean;
  query: string;
  /** Caret index where the @ token starts. */
  start: number;
  /** Highlighted suggestion index. */
  index: number;
};

const MENTION_TRIGGER = /(?:^|\s)@([a-z0-9-]*)$/;

function findMentionTrigger(text: string, caret: number): {
  start: number;
  query: string;
} | null {
  const before = text.slice(0, caret);
  const match = before.match(MENTION_TRIGGER);
  if (!match) return null;
  const tokenLen = match[1].length + 1; // includes the @
  return {
    start: caret - tokenLen,
    query: match[1].toLowerCase(),
  };
}

export function CommentComposer({
  members,
  onSubmit,
  placeholder = "Escreva um comentário…",
  disabled = false,
  initialValue = "",
  submitLabel = "Enviar",
  onCancel,
  autoFocus = false,
}: Props) {
  const [body, setBody] = useState(initialValue);
  const [submitting, setSubmitting] = useState(false);
  const [mention, setMention] = useState<MentionState>({
    open: false,
    query: "",
    start: 0,
    index: 0,
  });
  const taRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (autoFocus) taRef.current?.focus();
  }, [autoFocus]);

  const mentionable = useMemo(
    () => buildMentionableMembers(members),
    [members],
  );

  const suggestions = useMemo(() => {
    if (!mention.open) return [] as MentionableMember[];
    const q = mention.query;
    const list = q
      ? mentionable.filter(
          (m) =>
            m.slug.includes(q) ||
            (m.name ?? "").toLowerCase().includes(q),
        )
      : mentionable;
    return list.slice(0, 6);
  }, [mention.open, mention.query, mentionable]);

  function syncMention(text: string, caret: number) {
    const trigger = findMentionTrigger(text, caret);
    if (!trigger) {
      setMention((m) => (m.open ? { ...m, open: false } : m));
      return;
    }
    setMention({
      open: true,
      query: trigger.query,
      start: trigger.start,
      index: 0,
    });
  }

  function applyMention(slug: string) {
    const ta = taRef.current;
    if (!ta) return;
    const caret = ta.selectionStart ?? body.length;
    const { start } = mention;
    const inserted = `@${slug} `;
    const next = body.slice(0, start) + inserted + body.slice(caret);
    const nextCaret = start + inserted.length;
    setBody(next);
    setMention((m) => ({ ...m, open: false }));
    requestAnimationFrame(() => {
      ta.focus();
      ta.setSelectionRange(nextCaret, nextCaret);
    });
  }

  async function handleSubmit() {
    if (submitting || disabled) return;
    const trimmed = body.trim();
    if (!trimmed) return;
    setSubmitting(true);
    try {
      await onSubmit(trimmed);
      if (!initialValue) setBody("");
    } finally {
      setSubmitting(false);
    }
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (mention.open && suggestions.length > 0) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setMention((m) => ({
          ...m,
          index: (m.index + 1) % suggestions.length,
        }));
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setMention((m) => ({
          ...m,
          index: (m.index - 1 + suggestions.length) % suggestions.length,
        }));
        return;
      }
      if (e.key === "Enter" || e.key === "Tab") {
        e.preventDefault();
        applyMention(suggestions[mention.index].slug);
        return;
      }
      if (e.key === "Escape") {
        setMention((m) => ({ ...m, open: false }));
        return;
      }
    }
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
      e.preventDefault();
      void handleSubmit();
      return;
    }
    if (e.key === "Escape" && onCancel) {
      e.preventDefault();
      onCancel();
    }
  }

  const canSubmit = !submitting && !disabled && body.trim().length > 0;

  return (
    <div className="relative">
      <Textarea
        ref={taRef}
        value={body}
        disabled={disabled || submitting}
        placeholder={placeholder}
        rows={3}
        className="resize-y text-sm"
        onChange={(e) => {
          const next = e.target.value;
          setBody(next);
          syncMention(next, e.target.selectionStart ?? next.length);
        }}
        onKeyUp={(e) => {
          const ta = e.currentTarget;
          syncMention(ta.value, ta.selectionStart ?? ta.value.length);
        }}
        onKeyDown={onKeyDown}
        onClick={(e) => {
          const ta = e.currentTarget;
          syncMention(ta.value, ta.selectionStart ?? ta.value.length);
        }}
      />

      {mention.open && suggestions.length > 0 ? (
        <ul
          role="listbox"
          className="absolute left-2 top-full z-20 mt-1 w-[260px] overflow-hidden rounded-md border border-border bg-popover text-popover-foreground shadow-md ring-1 ring-foreground/10"
        >
          {suggestions.map((m, i) => (
            <li
              key={m.id}
              role="option"
              aria-selected={i === mention.index}
              onMouseDown={(e) => {
                e.preventDefault();
                applyMention(m.slug);
              }}
              className={cn(
                "flex cursor-pointer items-center justify-between px-2 py-1 text-xs",
                i === mention.index && "bg-accent text-accent-foreground",
              )}
            >
              <span className="truncate">{m.name ?? "(sem nome)"}</span>
              <span className="ml-2 truncate text-[10px] text-muted-foreground">
                @{m.slug}
              </span>
            </li>
          ))}
        </ul>
      ) : null}

      <div className="mt-1.5 flex items-center justify-between gap-2">
        <span className="text-[10px] text-muted-foreground">
          Markdown suportado · @nome pra mencionar · Cmd+Enter envia
        </span>
        <div className="flex items-center gap-1.5">
          {onCancel ? (
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={onCancel}
              disabled={submitting}
            >
              Cancelar
            </Button>
          ) : null}
          <Button
            type="button"
            size="sm"
            onClick={() => void handleSubmit()}
            disabled={!canSubmit}
          >
            <Send className="size-3.5" />
            {submitLabel}
          </Button>
        </div>
      </div>
    </div>
  );
}
