"use client";

import { cn } from "@/lib/utils";
import { ACCENT_CLASSES, type Accent } from "./tokens";
import { BoardAddRow } from "./add-row";
import { BoardEmptyState } from "./empty-state";
import type { LucideIcon } from "lucide-react";

type BoardColumnProps = {
  accent: Accent;
  icon: React.ReactNode;
  /** Eyebrow label rendered above the title — uppercase, tracking-wide. */
  eyebrow?: string;
  title: string;
  /** Single-line subtitle directly under the title. */
  subtitle?: string;
  count: number;
  /** Suffix shown after the count ("0 mapeada"). Singularizes automatically. */
  countLabel?: string;
  /** Right-side header content (e.g. layout switcher). Overrides countLabel. */
  headerAside?: React.ReactNode;

  /** Empty-state config. When children render nothing AND count === 0, this shows. */
  emptyIcon?: LucideIcon;
  emptyTitle?: string;
  emptyHint?: string;

  /** Add input at the footer. When omitted, no add row is rendered. */
  onAdd?: (text: string) => void;
  addPlaceholder?: string;

  /** Class overrides for the outer <section>. */
  className?: string;

  children?: React.ReactNode;
};

export function BoardColumn({
  accent,
  icon,
  eyebrow,
  title,
  subtitle,
  count,
  countLabel,
  headerAside,
  emptyIcon,
  emptyTitle,
  emptyHint,
  onAdd,
  addPlaceholder,
  className,
  children,
}: BoardColumnProps) {
  const cls = ACCENT_CLASSES[accent];

  const countText =
    countLabel && count === 1
      ? `${count} ${countLabel}`
      : countLabel
        ? `${count} ${countLabel}s`
        : String(count).padStart(2, "0");

  return (
    <section
      className={cn(
        "flex w-full flex-col rounded-xl border p-5",
        cls.frame,
        className,
      )}
    >
      <header className="mb-4 flex items-center gap-3 border-b border-foreground/[0.06] pb-3.5">
        <div
          className={cn(
            "flex size-8 shrink-0 items-center justify-center rounded-lg",
            cls.iconBg,
            cls.iconRing,
            cls.chip,
          )}
        >
          {icon}
        </div>
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          {eyebrow ? (
            <span className="text-[10px] font-medium uppercase leading-none tracking-[0.2em] text-muted-foreground">
              {eyebrow}
            </span>
          ) : null}
          <h3 className="font-heading text-[15px] font-semibold leading-tight tracking-tight">
            {title}
          </h3>
          {subtitle ? (
            <p className="mt-0.5 text-[11px] text-muted-foreground">
              {subtitle}
            </p>
          ) : null}
        </div>
        {headerAside ?? (
          <span
            className={cn(
              "inline-flex h-[26px] shrink-0 items-center gap-1.5 rounded-full px-3 font-mono text-[11px] tabular-nums tracking-[0.04em] ring-1 ring-inset ring-[var(--accent-surface-ring)]",
              cls.iconBg,
              cls.countText,
            )}
          >
            <span className="inline-block size-[5px] rounded-full bg-current" />
            {countText}
          </span>
        )}
      </header>

      <div className="flex-1 space-y-2.5">
        {count === 0 && emptyIcon && emptyTitle ? (
          <BoardEmptyState
            icon={emptyIcon}
            accent={accent}
            title={emptyTitle}
            hint={emptyHint}
          />
        ) : (
          children
        )}
      </div>

      {onAdd ? (
        <div className="mt-4">
          <BoardAddRow
            accent={accent}
            placeholder={addPlaceholder ?? "Adicionar..."}
            onAdd={onAdd}
          />
        </div>
      ) : null}
    </section>
  );
}
