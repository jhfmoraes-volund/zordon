"use client";

import { CalendarDays, GripVertical, Sparkles } from "lucide-react";

import { cn } from "@/lib/utils";
import { ACCENT_CLASSES, type Accent } from "@/components/design-session/board/tokens";
import { MemberAvatar } from "@/components/ui/member-avatar";
import { TagChip, TagChipOverflow } from "@/components/tags/tag-chip";
import { fmtDate, isOverdue } from "@/lib/date-utils";
import type { ChipTone } from "@/lib/status-chips";
import type { Member, Task } from "./types";

const MAX_AVATARS = 3;
const MAX_TAGS = 2;

type TaskCardProps = {
  task: Task;
  members: Member[];
  /** Esconde PFV (paridade com a coluna PFV da lista, oculta pra guest). */
  isGuest: boolean;
  /** Accent da coluna (status) — tinge o fundo e a barra lateral. */
  accent: Accent;
  onOpen: (ref: string) => void;
  /** Card arrastável → mostra o handle e usa cursor grab. */
  draggable?: boolean;
  /** Variante flutuante do DragOverlay (sombra forte, sem hover). */
  overlay?: boolean;
};

/**
 * Card compacto de task pro board Kanban — a "migração" da linha de grid da
 * TasksList pra um cartão. Clicar abre o mesmo TaskSheet (via onOpen). O drag
 * em si é cuidado pelo wrapper em tasks-kanban.tsx; aqui só o visual.
 */
export function TaskCard({
  task,
  members,
  isGuest,
  accent,
  onOpen,
  draggable = false,
  overlay = false,
}: TaskCardProps) {
  const cls = ACCENT_CLASSES[accent];
  const assignees = task.assigneeIds
    .map((id) => members.find((m) => m.id === id))
    .filter((m): m is Member => !!m);
  const extraAssignees = Math.max(0, assignees.length - MAX_AVATARS);
  const overdue = isOverdue(task.dueDate ?? null, task.status);
  const showFp = !isGuest && task.functionPoints > 0;

  return (
    <article
      role="button"
      tabIndex={0}
      aria-label={`Abrir ${task.reference}: ${task.title}`}
      onClick={() => onOpen(task.reference)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onOpen(task.reference);
        }
      }}
      className={cn(
        "group relative flex flex-col rounded-md py-2.5 pl-3.5 pr-2.5 text-left transition-[background-color,box-shadow] duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40",
        cls.cardBg,
        cls.cardRing,
        !overlay && cls.cardRingHover,
        !overlay && cls.cardBgHover,
        overlay ? "shadow-xl" : "",
        draggable ? "cursor-grab active:cursor-grabbing" : "cursor-pointer",
      )}
    >
      {/* barra de status (esquerda) — ecoa o tom da coluna */}
      <span
        aria-hidden
        className="pointer-events-none absolute inset-y-2 left-0 w-[3px] rounded-full opacity-70"
        style={{ backgroundColor: `var(--accent-${accent}-chip)` }}
      />

      <header className="mb-1.5 flex items-center gap-1.5">
        <span
          className="rounded bg-foreground/[0.06] px-1.5 py-0.5 font-mono text-[10.5px] text-muted-foreground"
          title={task.reference}
        >
          {task.reference}
        </span>
        {task.createdByAgent ? (
          <Sparkles className="size-3 shrink-0 text-muted-foreground/60" />
        ) : null}
        {draggable ? (
          <GripVertical className="ml-auto size-4 shrink-0 text-muted-foreground/40 transition-opacity group-hover:text-muted-foreground/70" />
        ) : null}
      </header>

      <p className="mb-2 line-clamp-2 text-[12.5px] font-medium leading-snug">
        {task.title}
      </p>

      {task.tags.length > 0 ? (
        <div className="mb-2 flex flex-wrap items-center gap-1">
          {task.tags.slice(0, MAX_TAGS).map((tg) => (
            <TagChip
              key={tg.id}
              name={tg.name}
              tone={tg.tone as ChipTone}
              variant="linear"
              size="sm"
            />
          ))}
          <TagChipOverflow
            count={Math.max(0, task.tags.length - MAX_TAGS)}
            variant="linear"
            size="sm"
          />
        </div>
      ) : null}

      <footer className="flex items-center gap-2">
        {assignees.length > 0 ? (
          <span className="flex items-center">
            {assignees.slice(0, MAX_AVATARS).map((m, i) => (
              <MemberAvatar
                key={m.id}
                name={m.name}
                className={cn(
                  "size-5 text-[9px] ring-2 ring-[var(--card)]",
                  i > 0 ? "-ml-1.5" : "",
                )}
              />
            ))}
            {extraAssignees > 0 ? (
              <span className="-ml-1.5 grid size-5 place-items-center rounded-full bg-muted text-[9px] font-semibold text-muted-foreground ring-2 ring-[var(--card)]">
                +{extraAssignees}
              </span>
            ) : null}
          </span>
        ) : (
          <span className="text-[11px] text-muted-foreground/70">Sem dono</span>
        )}

        {task.dueDate ? (
          <span
            className={cn(
              "inline-flex items-center gap-1 text-[10.5px]",
              overdue ? "text-red-600 dark:text-red-400" : "text-muted-foreground",
            )}
            title={overdue ? "Atrasada" : "Prazo"}
          >
            <CalendarDays className="size-3" />
            {fmtDate(task.dueDate)}
          </span>
        ) : null}

        {showFp ? (
          <span className="ml-auto inline-flex items-center rounded-md border px-1.5 py-0.5 font-mono text-[10.5px] tabular-nums text-muted-foreground">
            {task.functionPoints} PFV
          </span>
        ) : null}
      </footer>
    </article>
  );
}
