"use client";

/**
 * Primitivo de "file system" dos Zordon Apps — emula a lista da aba Drive
 * (src/components/project-drive/drive-tab.tsx), que é o padrão visual
 * canônico de superfície de app: grupos (pastas) → rows (arquivos) com
 * ações reveladas no hover. Todo app cujo output é enumerável renderiza
 * seus itens como arquivos com este componente.
 */

import type { LucideIcon } from "lucide-react";

import { cn } from "@/lib/utils";

export function AppFileList({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("surface divide-y divide-border/60 overflow-hidden", className)}>
      {children}
    </div>
  );
}

export function AppFileGroup({
  label,
  count,
  children,
}: {
  label: string;
  count?: number;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-2">
      <p className="px-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {label}
        {typeof count === "number" && (
          <span className="ml-1.5 font-normal normal-case tracking-normal">· {count}</span>
        )}
      </p>
      <AppFileList>{children}</AppFileList>
    </div>
  );
}

export function AppFileRow({
  icon: Icon,
  iconClassName,
  tileClassName,
  title,
  subtitle,
  badge,
  meta,
  actions,
  onOpen,
}: {
  icon: LucideIcon;
  iconClassName?: string;
  /** Quando presente, o ícone vira thumbnail (tile colorido, como arquivo no Finder). */
  tileClassName?: string;
  title: string;
  subtitle?: string;
  /** Chip à direita do título (ex.: status), estilo "no contexto" do Drive. */
  badge?: React.ReactNode;
  /** Texto à direita (data/contagem) — some no mobile, como no Drive. */
  meta?: string;
  /** Ações reveladas no hover (botões/links pequenos). */
  actions?: React.ReactNode;
  onOpen: () => void;
}) {
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onOpen();
        }
      }}
      className="group flex w-full cursor-pointer items-center gap-3 px-3 py-2.5 text-left transition-colors hover:bg-muted/60"
    >
      {tileClassName ? (
        <span
          className={cn(
            "flex size-9 shrink-0 items-center justify-center rounded-lg",
            tileClassName,
          )}
        >
          <Icon className={cn("size-4", iconClassName)} />
        </span>
      ) : (
        <Icon className={cn("h-5 w-5 shrink-0 text-muted-foreground", iconClassName)} />
      )}
      <div className="min-w-0 flex-1">
        <p className="line-clamp-2 text-sm font-medium sm:line-clamp-1">{title}</p>
        {subtitle && <p className="truncate text-xs text-muted-foreground">{subtitle}</p>}
      </div>
      {badge}
      {meta && (
        <span className="hidden w-24 shrink-0 text-right text-xs text-muted-foreground sm:inline">
          {meta}
        </span>
      )}
      {actions && <div className="flex shrink-0 items-center gap-1">{actions}</div>}
    </div>
  );
}

/** Chip no padrão do badge "no contexto" do Drive. */
export function AppFileBadge({
  children,
  tone = "muted",
}: {
  children: React.ReactNode;
  tone?: "green" | "amber" | "muted";
}) {
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center gap-0.5 rounded px-1 py-0.5 text-[10px] font-medium",
        tone === "green" && "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
        tone === "amber" && "bg-amber-500/10 text-amber-600 dark:text-amber-400",
        tone === "muted" && "bg-muted text-muted-foreground",
      )}
    >
      {children}
    </span>
  );
}
