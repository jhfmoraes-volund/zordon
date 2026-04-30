"use client";

import { useMemo, useState } from "react";
import {
  ChevronDown,
  ChevronRight,
  LayoutGrid,
  List,
  Plus,
  Sparkles,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { StatusChipSelect } from "@/components/ui/status-chip-select";
import { TASK_STATUS } from "@/lib/status-chips";
import { TaskStatusChip } from "./chips";
import type {
  Member,
  Module,
  Story,
  Task,
  TaskArea,
  TaskStatus,
} from "./types";

type SprintLite = {
  id: string;
  name: string;
};

type TasksListProps = {
  tasks: Task[];
  stories: Story[];
  modules: Module[];
  members: Member[];
  onOpenTask: (ref: string) => void;
  onCreateTask?: () => void;

  // ─── Optional inline-edit callbacks (legacy parity) ────────────────────────
  onChangeStatus?: (taskRef: string, status: TaskStatus) => void;
  onChangeAssignee?: (taskRef: string, memberId: string | null) => void;
  sprints?: SprintLite[];
  onChangeSprint?: (taskRef: string, sprintId: string | null) => void;
};

type GroupBy = "story" | "none";

const AREA_OPTIONS: { value: TaskArea | "__all"; label: string }[] = [
  { value: "__all", label: "Todas as areas" },
  { value: "front", label: "Front" },
  { value: "back",  label: "Back"  },
  { value: "infra", label: "Infra" },
  { value: "ops",   label: "Ops"   },
  { value: "mixed", label: "Mixed" },
  { value: null,    label: "Sem area" },
];

const STATUS_OPTIONS: { value: TaskStatus | "__all"; label: string }[] = [
  { value: "__all",       label: "Todos status" },
  { value: "todo",        label: "To do"       },
  { value: "in_progress", label: "In progress" },
  { value: "review",      label: "Review"      },
  { value: "done",        label: "Done"        },
  { value: "backlog",     label: "Backlog"     },
  { value: "draft",       label: "Draft"       },
];

const ASSIGNEE_NONE = "__none__";
const SPRINT_NONE = "__none__";

const stop = (e: React.MouseEvent | React.PointerEvent) =>
  e.stopPropagation();

export function TasksList({
  tasks,
  stories,
  modules,
  members,
  onOpenTask,
  onCreateTask,
  onChangeStatus,
  onChangeAssignee,
  sprints,
  onChangeSprint,
}: TasksListProps) {
  const [groupBy, setGroupBy] = useState<GroupBy>("story");
  const [moduleFilter, setModuleFilter] = useState<string>("__all");
  const [areaFilter, setAreaFilter] = useState<string>("__all");
  const [statusFilter, setStatusFilter] = useState<string>("__all");

  const filtered = useMemo(() => {
    return tasks.filter((t) => {
      const story = stories.find((s) => s.reference === t.userStoryRef);
      const moduleId = story?.moduleId ?? null;

      if (moduleFilter !== "__all" && moduleFilter !== moduleId) return false;
      if (areaFilter !== "__all") {
        const want = areaFilter === "null" ? null : (areaFilter as TaskArea);
        if (t.area !== want) return false;
      }
      if (statusFilter !== "__all" && t.status !== statusFilter) return false;
      return true;
    });
  }, [tasks, stories, moduleFilter, areaFilter, statusFilter]);

  const showSprint = !!(sprints && onChangeSprint);

  const editing: RowEditingProps = {
    members,
    sprints,
    showSprint,
    onOpenTask,
    onChangeStatus,
    onChangeAssignee,
    onChangeSprint,
  };

  return (
    <div className="space-y-4">
      {/* Toolbar ─────────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-2">
        <Select
          value={moduleFilter}
          onValueChange={(v) => v && setModuleFilter(v)}
        >
          <SelectTrigger className="h-8 w-[160px] text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__all">Todos módulos</SelectItem>
            {modules.map((m) => (
              <SelectItem key={m.id} value={m.id}>
                <span className="font-mono">{m.name}</span>
              </SelectItem>
            ))}
            <SelectItem value="null">— sem módulo —</SelectItem>
          </SelectContent>
        </Select>

        <Select
          value={areaFilter}
          onValueChange={(v) => v && setAreaFilter(v)}
        >
          <SelectTrigger className="h-8 w-[140px] text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {AREA_OPTIONS.map((opt) => (
              <SelectItem
                key={String(opt.value)}
                value={opt.value === null ? "null" : String(opt.value)}
              >
                {opt.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select
          value={statusFilter}
          onValueChange={(v) => v && setStatusFilter(v)}
        >
          <SelectTrigger className="h-8 w-[140px] text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {STATUS_OPTIONS.map((opt) => (
              <SelectItem key={String(opt.value)} value={String(opt.value)}>
                {opt.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <div className="ml-auto flex items-center gap-1">
          <div className="flex overflow-hidden rounded-md border">
            <button
              type="button"
              onClick={() => setGroupBy("story")}
              className={`flex h-8 items-center gap-1 px-2 text-[11px] ${
                groupBy === "story"
                  ? "bg-muted text-foreground"
                  : "text-muted-foreground hover:bg-muted/50"
              }`}
              title="Agrupar por story"
            >
              <LayoutGrid className="size-3.5" />
              Story
            </button>
            <button
              type="button"
              onClick={() => setGroupBy("none")}
              className={`flex h-8 items-center gap-1 border-l px-2 text-[11px] ${
                groupBy === "none"
                  ? "bg-muted text-foreground"
                  : "text-muted-foreground hover:bg-muted/50"
              }`}
              title="Lista plana"
            >
              <List className="size-3.5" />
              Flat
            </button>
          </div>
          {onCreateTask ? (
            <Button size="sm" onClick={onCreateTask}>
              <Plus className="size-3.5" />
              Nova task
            </Button>
          ) : null}
        </div>
      </div>

      <div className="text-xs text-muted-foreground">
        <span className="font-mono tabular-nums">{filtered.length}</span> de{" "}
        <span className="font-mono tabular-nums">{tasks.length}</span> tasks
      </div>

      {/* Body ───────────────────────────────────────────────────────── */}
      {groupBy === "story" ? (
        <GroupedByStory
          tasks={filtered}
          stories={stories}
          modules={modules}
          editing={editing}
        />
      ) : (
        <FlatList
          tasks={filtered}
          stories={stories}
          modules={modules}
          editing={editing}
        />
      )}
    </div>
  );
}

// ─── Grouped by story ────────────────────────────────────────────────────────

type RowEditingProps = {
  members: Member[];
  sprints?: SprintLite[];
  showSprint: boolean;
  onOpenTask: (ref: string) => void;
  onChangeStatus?: (taskRef: string, status: TaskStatus) => void;
  onChangeAssignee?: (taskRef: string, memberId: string | null) => void;
  onChangeSprint?: (taskRef: string, sprintId: string | null) => void;
};

function GroupedByStory({
  tasks,
  stories,
  modules,
  editing,
}: {
  tasks: Task[];
  stories: Story[];
  modules: Module[];
  editing: RowEditingProps;
}) {
  const groups = useMemo(() => {
    const byStoryRef = new Map<string | "__orphan", Task[]>();
    for (const t of tasks) {
      const key = t.userStoryRef ?? "__orphan";
      const arr = byStoryRef.get(key) ?? [];
      arr.push(t);
      byStoryRef.set(key, arr);
    }
    return Array.from(byStoryRef.entries()).map(([key, rows]) => {
      const story =
        key === "__orphan" ? null : stories.find((s) => s.reference === key) ?? null;
      const mod = story ? modules.find((m) => m.id === story.moduleId) : null;
      return { key, story, module: mod, rows };
    });
  }, [tasks, stories, modules]);

  if (groups.length === 0) {
    return (
      <div className="rounded-md border border-dashed p-6 text-center text-xs text-muted-foreground">
        Nenhuma task com esses filtros.
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {groups.map((g) => (
        <StoryGroupBlock
          key={g.key}
          storyTitle={g.story?.title ?? "Tasks sem story"}
          storyRef={g.story?.reference ?? null}
          moduleName={g.module?.name ?? null}
          rows={g.rows}
          editing={editing}
        />
      ))}
    </div>
  );
}

function StoryGroupBlock({
  storyTitle,
  storyRef,
  moduleName,
  rows,
  editing,
}: {
  storyTitle: string;
  storyRef: string | null;
  moduleName: string | null;
  rows: Task[];
  editing: RowEditingProps;
}) {
  const [open, setOpen] = useState(true);
  const totalFP = rows.reduce((acc, t) => acc + t.functionPoints, 0);
  const doneFP = rows
    .filter((t) => t.status === "done")
    .reduce((acc, t) => acc + t.functionPoints, 0);

  return (
    <section className="overflow-hidden rounded-xl border">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2 border-b bg-muted/30 px-3 py-2 text-left text-xs hover:bg-muted/50"
      >
        {open ? (
          <ChevronDown className="size-3.5 text-muted-foreground" />
        ) : (
          <ChevronRight className="size-3.5 text-muted-foreground" />
        )}
        {moduleName ? (
          <Badge variant="outline" className="font-mono text-[10px]">
            {moduleName}
          </Badge>
        ) : null}
        {storyRef ? (
          <span className="font-mono text-[10px] text-muted-foreground">
            {storyRef}
          </span>
        ) : (
          <Badge
            variant="outline"
            className="border-dashed text-[10px] text-muted-foreground"
          >
            sem story
          </Badge>
        )}
        <span className="truncate font-medium">{storyTitle}</span>
        <span className="ml-auto flex items-center gap-3 text-[10px] text-muted-foreground">
          <span className="font-mono tabular-nums">
            {rows.length} task{rows.length === 1 ? "" : "s"}
          </span>
          <span className="font-mono tabular-nums">
            {doneFP}/{totalFP} FP
          </span>
        </span>
      </button>
      {open ? <TasksTable rows={rows} editing={editing} /> : null}
    </section>
  );
}

// ─── Flat list ───────────────────────────────────────────────────────────────

function FlatList({
  tasks,
  stories,
  modules,
  editing,
}: {
  tasks: Task[];
  stories: Story[];
  modules: Module[];
  editing: RowEditingProps;
}) {
  if (tasks.length === 0) {
    return (
      <div className="rounded-md border border-dashed p-6 text-center text-xs text-muted-foreground">
        Nenhuma task com esses filtros.
      </div>
    );
  }
  return (
    <div className="overflow-hidden rounded-xl border">
      <TasksTable
        rows={tasks}
        editing={editing}
        storyHint={(t) => {
          const story = stories.find((s) => s.reference === t.userStoryRef);
          if (!story) return { module: null, ref: null };
          const mod = modules.find((m) => m.id === story.moduleId);
          return {
            module: mod?.name ?? null,
            ref: story.reference,
          };
        }}
      />
    </div>
  );
}

// ─── Inner table (matching StoriesList compact aesthetic) ────────────────────

function TasksTable({
  rows,
  editing,
  storyHint,
}: {
  rows: Task[];
  editing: RowEditingProps;
  storyHint?: (task: Task) => { module: string | null; ref: string | null };
}) {
  // Match StoriesList grid look. Cells are spans inside a clickable row.
  // Cols: Ref · Title · [Story] · [Sprint] · Status · FP · Assignee
  const layoutParts: string[] = ["110px", "1fr"];
  if (storyHint) layoutParts.push("160px");
  if (editing.showSprint) layoutParts.push("130px");
  layoutParts.push("130px", "70px", "150px");
  const cols = `grid-cols-[${layoutParts.join("_")}]`;

  return (
    <div>
      {/* Header */}
      <div
        className={`grid gap-3 border-b bg-muted/30 px-3 py-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground ${cols}`}
      >
        <span>Ref</span>
        <span>Título</span>
        {storyHint ? <span>Story</span> : null}
        {editing.showSprint ? <span>Sprint</span> : null}
        <span>Status</span>
        <span className="text-right">FP</span>
        <span className="text-right">Assignee</span>
      </div>

      {/* Rows */}
      {rows.map((task, i) => {
        const hint = storyHint?.(task);
        const firstAssignee = task.assigneeIds[0] ?? null;
        const isLast = i === rows.length - 1;

        return (
          <div
            key={task.reference}
            role="button"
            tabIndex={0}
            onClick={() => editing.onOpenTask(task.reference)}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                editing.onOpenTask(task.reference);
              }
            }}
            className={`grid w-full cursor-pointer items-center gap-3 px-3 py-2.5 text-left text-sm transition-colors hover:bg-muted/40 ${cols} ${
              !isLast ? "border-b" : ""
            }`}
          >
            <span className="font-mono text-xs text-muted-foreground">
              {task.reference}
            </span>

            <span className="flex min-w-0 items-center gap-2">
              <span className="truncate">{task.title}</span>
              {task.createdByAgent ? (
                <Sparkles className="size-3 shrink-0 text-muted-foreground/60" />
              ) : null}
            </span>

            {storyHint ? (
              <span className="flex min-w-0 items-center gap-1.5 text-muted-foreground">
                {hint?.module ? (
                  <Badge variant="outline" className="font-mono text-[10px]">
                    {hint.module}
                  </Badge>
                ) : null}
                <span className="truncate font-mono text-[10px]">
                  {hint?.ref ?? "—"}
                </span>
              </span>
            ) : null}

            {editing.showSprint ? (
              <span onClick={stop} onPointerDown={stop}>
                <SprintCell
                  task={task}
                  sprints={editing.sprints!}
                  onChangeSprint={editing.onChangeSprint!}
                />
              </span>
            ) : null}

            {/* Status: chip-select (legacy aesthetic) */}
            <span onClick={stop} onPointerDown={stop}>
              {editing.onChangeStatus ? (
                <StatusChipSelect
                  value={task.status}
                  options={TASK_STATUS}
                  onValueChange={(v) =>
                    editing.onChangeStatus!(task.reference, v as TaskStatus)
                  }
                />
              ) : (
                <TaskStatusChip status={task.status} />
              )}
            </span>

            <span className="text-right font-mono text-xs tabular-nums">
              {task.functionPoints}
            </span>

            {/* Assignee: borderless select for compact look */}
            {editing.onChangeAssignee ? (
              <span onClick={stop} onPointerDown={stop}>
                <AssigneeCell
                  taskRef={task.reference}
                  value={firstAssignee}
                  members={editing.members}
                  onChange={editing.onChangeAssignee}
                />
              </span>
            ) : (
              <span className="truncate text-right text-[11px] text-muted-foreground">
                {task.assigneeIds.length === 0
                  ? "—"
                  : task.assigneeIds
                      .map((id) => editing.members.find((m) => m.id === id)?.name)
                      .filter(Boolean)
                      .join(", ")}
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ─── Inline editors (compact, borderless triggers) ───────────────────────────

function AssigneeCell({
  taskRef,
  value,
  members,
  onChange,
}: {
  taskRef: string;
  value: string | null;
  members: Member[];
  onChange: (ref: string, memberId: string | null) => void;
}) {
  return (
    <Select
      value={value ?? ASSIGNEE_NONE}
      onValueChange={(v) => {
        if (v === null) return;
        onChange(taskRef, v === ASSIGNEE_NONE ? null : v);
      }}
    >
      <SelectTrigger
        size="sm"
        className="h-7 w-full justify-end border-none bg-transparent p-0 text-[11px] text-muted-foreground shadow-none hover:opacity-80"
      >
        <SelectValue placeholder="Ninguém" />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={ASSIGNEE_NONE}>
          <span className="text-muted-foreground">Ninguém</span>
        </SelectItem>
        {members.map((m) => (
          <SelectItem key={m.id} value={m.id}>
            {m.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function SprintCell({
  task,
  sprints,
  onChangeSprint,
}: {
  task: Task;
  sprints: SprintLite[];
  onChangeSprint: (ref: string, sprintId: string | null) => void;
}) {
  return (
    <Select
      value={task.sprintId ?? SPRINT_NONE}
      onValueChange={(v) => {
        if (v === null) return;
        onChangeSprint(task.reference, v === SPRINT_NONE ? null : v);
      }}
    >
      <SelectTrigger
        size="sm"
        className="h-7 w-full border-none bg-transparent p-0 text-[11px] text-muted-foreground shadow-none hover:opacity-80"
      >
        <SelectValue placeholder="Sem sprint" />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={SPRINT_NONE}>
          <span className="text-muted-foreground">Sem sprint</span>
        </SelectItem>
        {sprints.map((s) => (
          <SelectItem key={s.id} value={s.id}>
            {s.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
