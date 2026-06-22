"use client";

import { useMemo, useState } from "react";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  pointerWithin,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import {
  Ban,
  CircleCheckBig,
  Circle,
  Eye,
  Inbox,
  SquarePen,
  Timer,
  type LucideIcon,
} from "lucide-react";

import { cn } from "@/lib/utils";
import { ACCENT_CLASSES, type Accent } from "@/components/design-session/board/tokens";
import { useIsGuest } from "@/hooks/use-is-guest";
import { TaskCard } from "./task-card";
import { TASK_STATUS_MAP } from "./chips";
import type { Member, Task, TaskStatus } from "./types";

// Ordem das colunas = pipeline de status (espelha STATUS_RANK em ./sort).
// `draft` ("não aceito no plano") só ganha coluna quando há tasks nesse estado.
const COLUMN_ORDER: TaskStatus[] = [
  "draft",
  "backlog",
  "todo",
  "in_progress",
  "blocked",
  "review",
  "done",
];

// Status → accent do board (cores reais de board/tokens.ts).
const STATUS_ACCENT: Record<TaskStatus, Accent> = {
  draft: "amber",
  backlog: "neutral",
  todo: "sky",
  in_progress: "amber",
  blocked: "red",
  review: "violet",
  done: "emerald",
};

const STATUS_ICON: Record<TaskStatus, LucideIcon> = {
  draft: SquarePen,
  backlog: Inbox,
  todo: Circle,
  in_progress: Timer,
  blocked: Ban,
  review: Eye,
  done: CircleCheckBig,
};

type TasksKanbanProps = {
  /** Tasks já filtradas + ordenadas pelo TasksList. */
  tasks: Task[];
  members: Member[];
  onOpenTask: (ref: string) => void;
  /** Quando ausente (ou guest), o board fica read-only — sem drag. */
  onChangeStatus?: (taskRef: string, status: TaskStatus) => void;
};

export function TasksKanban({
  tasks,
  members,
  onOpenTask,
  onChangeStatus,
}: TasksKanbanProps) {
  const isGuest = useIsGuest();
  const dragEnabled = !!onChangeStatus && !isGuest;

  const sensors = useSensors(
    // distance:6 → um clique (sem mover) abre o sheet; mover >6px inicia o drag.
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
  );

  const [activeRef, setActiveRef] = useState<string | null>(null);

  // Agrupa por status preservando a ordem de entrada (já ordenada).
  const byStatus = useMemo(() => {
    const map = new Map<TaskStatus, Task[]>();
    for (const s of COLUMN_ORDER) map.set(s, []);
    for (const t of tasks) {
      const arr = map.get(t.status);
      if (arr) arr.push(t);
      else map.set(t.status, [t]);
    }
    return map;
  }, [tasks]);

  const columns = COLUMN_ORDER.filter(
    (s) => s !== "draft" || (byStatus.get("draft")?.length ?? 0) > 0,
  );

  const activeTask = activeRef
    ? tasks.find((t) => t.reference === activeRef) ?? null
    : null;

  function handleDragStart(e: DragStartEvent) {
    setActiveRef(String(e.active.id));
  }

  function handleDragEnd(e: DragEndEvent) {
    setActiveRef(null);
    if (!e.over) return;
    const ref = String(e.active.id);
    const target = String(e.over.id) as TaskStatus;
    const task = tasks.find((t) => t.reference === ref);
    if (!task || task.status === target) return;
    // Reusa o mesmo callback do dropdown inline da lista → update otimista +
    // PATCH /api/tasks/bulk no parent. Sem API nova.
    onChangeStatus?.(ref, target);
  }

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={pointerWithin}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
      onDragCancel={() => setActiveRef(null)}
    >
      <div className="flex gap-3 overflow-x-auto pb-2">
        {columns.map((status) => {
          const colTasks = byStatus.get(status) ?? [];
          const fp = colTasks.reduce((acc, t) => acc + (t.functionPoints ?? 0), 0);
          return (
            <KanbanColumn
              key={status}
              status={status}
              tasks={colTasks}
              fp={fp}
              members={members}
              isGuest={isGuest}
              onOpen={onOpenTask}
              dragEnabled={dragEnabled}
            />
          );
        })}
      </div>

      <DragOverlay dropAnimation={null}>
        {activeTask ? (
          <div className="w-[272px] rotate-2">
            <TaskCard
              task={activeTask}
              members={members}
              isGuest={isGuest}
              accent={STATUS_ACCENT[activeTask.status]}
              onOpen={() => {}}
              overlay
            />
          </div>
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}

// ─── Column ──────────────────────────────────────────────────────────────────

function KanbanColumn({
  status,
  tasks,
  fp,
  members,
  isGuest,
  onOpen,
  dragEnabled,
}: {
  status: TaskStatus;
  tasks: Task[];
  fp: number;
  members: Member[];
  isGuest: boolean;
  onOpen: (ref: string) => void;
  dragEnabled: boolean;
}) {
  const accent = STATUS_ACCENT[status];
  const cls = ACCENT_CLASSES[accent];
  const meta = TASK_STATUS_MAP[status];
  const Icon = STATUS_ICON[status];
  const { setNodeRef, isOver } = useDroppable({ id: status, disabled: !dragEnabled });

  return (
    <section
      ref={setNodeRef}
      className={cn(
        "flex w-[300px] shrink-0 flex-col rounded-xl border p-3.5 transition-shadow",
        cls.frame,
      )}
      style={
        isOver && dragEnabled
          ? { boxShadow: `inset 0 0 0 2px var(--accent-${accent}-ring)` }
          : undefined
      }
      aria-label={`Coluna ${meta.label}`}
    >
      <header className="mb-3 flex items-center gap-2.5 border-b border-foreground/[0.06] pb-3">
        <div
          className={cn(
            "flex size-7 shrink-0 items-center justify-center rounded-lg",
            cls.iconBg,
            cls.iconRing,
            cls.chip,
          )}
        >
          <Icon className="size-3.5" />
        </div>
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-[13px] font-semibold leading-tight tracking-tight">
            {meta.label}
          </h3>
          {!isGuest && fp > 0 ? (
            <p className="font-mono text-[10px] leading-none text-muted-foreground">
              {fp} PFV
            </p>
          ) : null}
        </div>
        <span
          className={cn(
            "inline-flex h-6 shrink-0 items-center rounded-full px-2.5 font-mono text-[11px] tabular-nums ring-1 ring-inset ring-[var(--accent-surface-ring)]",
            cls.iconBg,
            cls.countText,
          )}
        >
          {String(tasks.length).padStart(2, "0")}
        </span>
      </header>

      <div className="flex flex-1 flex-col gap-2.5">
        {tasks.length === 0 ? (
          <div className="rounded-md border border-dashed border-border/60 py-7 text-center text-[11px] text-muted-foreground/70">
            {dragEnabled ? "Arraste tasks pra cá" : "Vazio"}
          </div>
        ) : (
          tasks.map((task) => (
            <DraggableTaskCard
              key={task.reference}
              task={task}
              members={members}
              isGuest={isGuest}
              accent={accent}
              onOpen={onOpen}
              dragEnabled={dragEnabled}
            />
          ))
        )}
      </div>
    </section>
  );
}

// ─── Draggable wrapper ─────────────────────────────────────────────────────────
// Só os listeners de ponteiro vão no wrapper; o TaskCard mantém role/onClick
// (abrir o sheet). KeyboardSensor fica de fora de propósito pra não colidir com
// o Enter/Espaço de "abrir" — teclado abre o sheet e muda o status por lá.

function DraggableTaskCard({
  task,
  members,
  isGuest,
  accent,
  onOpen,
  dragEnabled,
}: {
  task: Task;
  members: Member[];
  isGuest: boolean;
  accent: Accent;
  onOpen: (ref: string) => void;
  dragEnabled: boolean;
}) {
  const { setNodeRef, listeners, isDragging } = useDraggable({
    id: task.reference,
    disabled: !dragEnabled,
  });

  return (
    <div
      ref={setNodeRef}
      {...listeners}
      className={isDragging ? "opacity-40" : undefined}
      style={dragEnabled ? { touchAction: "none" } : undefined}
    >
      <TaskCard
        task={task}
        members={members}
        isGuest={isGuest}
        accent={accent}
        onOpen={onOpen}
        draggable={dragEnabled}
      />
    </div>
  );
}
