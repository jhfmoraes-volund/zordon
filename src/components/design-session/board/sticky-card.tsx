"use client";

import { useState } from "react";
import { ChevronDown, ChevronUp, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  ACCENT_CLASSES,
  SEVERITY_BORDER,
  type Accent,
  type SeverityTone,
} from "./tokens";

type StickyCardVariant = "default" | "paper";

// Paper variant uses CSS vars defined in globals.css (--paper-{tone}-*).
// Mapped here so the variant API stays declarative.
const PAPER_VARS: Record<
  Extract<Accent, "sky" | "emerald" | "rose" | "amber"> | "neutral",
  { bg: string; border: string; text: string }
> = {
  sky: {
    bg: "var(--paper-sky-bg)",
    border: "var(--paper-sky-border)",
    text: "var(--paper-sky-text)",
  },
  emerald: {
    bg: "var(--paper-emerald-bg)",
    border: "var(--paper-emerald-border)",
    text: "var(--paper-emerald-text)",
  },
  rose: {
    bg: "var(--paper-rose-bg)",
    border: "var(--paper-rose-border)",
    text: "var(--paper-rose-text)",
  },
  amber: {
    bg: "var(--paper-amber-bg)",
    border: "var(--paper-amber-border)",
    text: "var(--paper-amber-text)",
  },
  neutral: {
    bg: "var(--muted)",
    border: "var(--border)",
    text: "var(--muted-foreground)",
  },
};

type PaperAccent = keyof typeof PAPER_VARS;

function isPaperAccent(a: Accent): a is PaperAccent {
  return a === "sky" || a === "emerald" || a === "rose" || a === "amber" || a === "neutral";
}

export type StickyCardProps = {
  accent: Accent;
  variant?: StickyCardVariant;
  /** Optional 4px left border indicating severity. */
  severity?: SeverityTone;
  /** Chips at the top-left (status/category/feature/etc). */
  chips?: React.ReactNode;
  /** Custom actions at the top-right. Replaces the default expand/delete pair. */
  actions?: React.ReactNode;
  /** Default delete handler. Renders the trash button when `actions` is omitted. */
  onDelete?: () => void;
  /** Default expand handler. When omitted, card stays in the controlled state below. */
  expanded?: boolean;
  onExpandChange?: (next: boolean) => void;
  /** Body when collapsed. Usually the item's text. Click to expand. */
  collapsed: React.ReactNode;
  /** Body when expanded — full edit form. */
  expandedBody?: React.ReactNode;
  /** Inline footer rendered ONLY when collapsed — e.g. "● mitigation registered". */
  collapsedFooter?: React.ReactNode;
  /** Class overrides for the outer wrapper. */
  className?: string;
};

/**
 * StickyCard — board item primitive used across Design Session steps.
 *
 * Variants:
 *   - `default`: translucent tint matching the column accent. Used in
 *     risks_gaps, prioritization, hypotheses, brainstorm.
 *   - `paper`: pastel paper feel using --paper-* CSS vars. Used in
 *     scope_definition (post-its). Severity / expand are typically off.
 */
export function StickyCard({
  accent,
  variant = "default",
  severity,
  chips,
  actions,
  onDelete,
  expanded: expandedProp,
  onExpandChange,
  collapsed,
  expandedBody,
  collapsedFooter,
  className,
}: StickyCardProps) {
  const isControlled = expandedProp !== undefined;
  const [internalExpanded, setInternalExpanded] = useState(false);
  const expanded = isControlled ? expandedProp : internalExpanded;

  const setExpanded = (next: boolean) => {
    if (!isControlled) setInternalExpanded(next);
    onExpandChange?.(next);
  };

  // ── Default (translucent) variant ───────────────────────────────────
  if (variant === "default") {
    const cls = ACCENT_CLASSES[accent];
    return (
      <article
        className={cn(
          "group rounded-md transition-[background-color,box-shadow] duration-150",
          cls.cardBg,
          cls.cardRing,
          cls.cardRingHover,
          cls.cardBgHover,
          severity ? "border-l-4" : "",
          severity ? SEVERITY_BORDER[severity] : "",
          expanded ? "ring-ring/30" : "",
          className,
        )}
      >
        {(chips || actions || onDelete || expandedBody) && (
          <div className="flex items-center gap-1.5 px-3 pt-2.5">
            {chips}
            <div className="ml-auto flex items-center gap-0.5">
              {actions}
              {!actions && expandedBody ? (
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-7 text-muted-foreground hover:text-foreground"
                  onClick={() => setExpanded(!expanded)}
                  aria-label={expanded ? "Recolher" : "Expandir"}
                >
                  {expanded ? (
                    <ChevronUp className="size-3.5" />
                  ) : (
                    <ChevronDown className="size-3.5" />
                  )}
                </Button>
              ) : null}
              {!actions && onDelete ? (
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-7 text-muted-foreground hover:text-destructive"
                  onClick={onDelete}
                  aria-label="Excluir"
                >
                  <Trash2 className="size-3.5" />
                </Button>
              ) : null}
            </div>
          </div>
        )}

        <div
          className={cn(
            "px-3 pb-3 pt-2",
            expandedBody && !expanded
              ? "cursor-text"
              : "",
          )}
          onClick={() => {
            if (expandedBody && !expanded) setExpanded(true);
          }}
        >
          {expanded && expandedBody ? expandedBody : collapsed}
        </div>

        {!expanded && collapsedFooter ? (
          <div className="border-t border-border/30 px-3 py-1.5">
            {collapsedFooter}
          </div>
        ) : null}
      </article>
    );
  }

  // ── Paper variant ───────────────────────────────────────────────────
  // Pastel paper feel. Severity border still applies; chips/actions render
  // in the same slot but with paper-tone background.
  const paper = isPaperAccent(accent) ? PAPER_VARS[accent] : PAPER_VARS.neutral;

  return (
    <article
      className={cn(
        "group relative flex flex-col rounded-md p-3 transition-transform duration-150 hover:-translate-y-0.5",
        severity ? "border-l-4" : "",
        severity ? SEVERITY_BORDER[severity] : "",
        className,
      )}
      style={{
        backgroundColor: paper.bg,
        borderTop: severity ? undefined : `0 solid ${paper.border}`,
        borderRight: `1px solid ${paper.border}`,
        borderBottom: `1px solid ${paper.border}`,
        borderLeft: severity ? undefined : `3px solid ${paper.border}`,
        color: paper.text,
        boxShadow: "var(--paper-shadow)",
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.boxShadow = "var(--paper-shadow-hover)";
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.boxShadow = "var(--paper-shadow)";
      }}
    >
      {chips || actions || onDelete ? (
        <div className="mb-1 flex items-center gap-1.5">
          {chips}
          <div className="ml-auto flex items-center gap-0.5">
            {actions}
            {!actions && onDelete ? (
              <button
                type="button"
                onClick={onDelete}
                aria-label="Remover"
                className="rounded p-0.5 opacity-0 transition-opacity hover:bg-black/10 group-hover:opacity-100 dark:hover:bg-white/10"
                style={{ color: paper.text }}
              >
                <Trash2 className="size-3.5" />
              </button>
            ) : null}
          </div>
        </div>
      ) : null}

      <div className="flex-1" style={{ color: paper.text }}>
        {expanded && expandedBody ? expandedBody : collapsed}
      </div>

      {!expanded && collapsedFooter ? (
        <div className="mt-1 pt-1 text-[10px] opacity-75">
          {collapsedFooter}
        </div>
      ) : null}
    </article>
  );
}
