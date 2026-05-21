"use client";

import { cn } from "@/lib/utils";
import { ACCENT_CLASSES, type Accent } from "./tokens";

type BoardSectionProps = {
  accent: Accent;
  icon?: React.ReactNode;
  /** Custom left visual replacing the icon (e.g. persona avatar). */
  leading?: React.ReactNode;
  eyebrow?: string;
  title: string;
  subtitle?: string;
  headerAside?: React.ReactNode;
  className?: string;
  bodyClassName?: string;
  children?: React.ReactNode;
};

/**
 * Same outer shell as BoardColumn but without the items-list/empty-state/
 * add-row machinery. Use for narrative forms (product_vision,
 * technical_specs, persona profile etc.) where the body is Textareas /
 * Fields, not a list of items.
 */
export function BoardSection({
  accent,
  icon,
  leading,
  eyebrow,
  title,
  subtitle,
  headerAside,
  className,
  bodyClassName,
  children,
}: BoardSectionProps) {
  const cls = ACCENT_CLASSES[accent];

  return (
    <section
      className={cn(
        "flex w-full flex-col rounded-xl border p-5",
        cls.frame,
        className,
      )}
    >
      <header className="mb-4 flex items-center gap-3 border-b border-foreground/[0.06] pb-3.5">
        {leading ??
          (icon ? (
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
          ) : null)}
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
        {headerAside ? <div className="shrink-0">{headerAside}</div> : null}
      </header>

      <div className={cn("flex-1", bodyClassName)}>{children}</div>
    </section>
  );
}
