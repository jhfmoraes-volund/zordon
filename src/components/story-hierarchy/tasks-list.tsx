"use client";

import { useEffect, useMemo, useState } from "react";
import {
  ArrowDown,
  ArrowUp,
  ChevronDown,
  ChevronRight,
  LayoutGrid,
  List,
  Plus,
  SlidersHorizontal,
  Sparkles,
  X,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { useIsMobile } from "@/hooks/use-mobile";
import { StatusChipSelect } from "@/components/ui/status-chip-select";
import { TASK_STATUS } from "@/lib/status-chips";
import { TaskStatusChip } from "./chips";
import { TaskRowMenu } from "./task-row-menu";
import { BulkActionsBar } from "./bulk-actions-bar";
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

  // ─── Row menu callbacks (3-dot menu). When all 4 are passed, column shows. ─
  onDuplicate?: (taskRef: string) => void;
  onClone?: (taskRef: string) => void;
  onCopyRef?: (taskRef: string) => void;
  onDelete?: (taskRef: string) => void;

  // ─── Bulk callbacks. When provided, checkbox column appears. ──────────────
  onBulkUpdate?: (
    taskRefs: string[],
    patch: {
      status?: TaskStatus;
      assigneeId?: string | null;
      sprintId?: string | null;
    },
  ) => void | Promise<void>;
  onBulkDelete?: (taskRefs: string[]) => void | Promise<void>;
  onBulkDuplicate?: (taskRefs: string[]) => void | Promise<void>;
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
  onDuplicate,
  onClone,
  onCopyRef,
  onDelete,
  onBulkUpdate,
  onBulkDelete,
  onBulkDuplicate,
}: TasksListProps) {
  const [groupBy, setGroupBy] = useState<GroupBy>("none");
  const [moduleFilter, setModuleFilter] = useState<string>("__all");
  const [areaFilter, setAreaFilter] = useState<string>("__all");
  const [statusFilter, setStatusFilter] = useState<string>("__all");
  const [assigneeFilter, setAssigneeFilter] = useState<string>("__all");
  const [filtersSheetOpen, setFiltersSheetOpen] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const isMobile = useIsMobile();

  const bulkEnabled = !!(onBulkUpdate || onBulkDelete);

  const toggleOne = (ref: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(ref)) next.delete(ref);
      else next.add(ref);
      return next;
    });
  };

  const clearSelection = () => setSelected(new Set());

  const selectedRefs = useMemo(() => Array.from(selected), [selected]);

  // Fecha o bottom sheet automaticamente se a janela cresce pra desktop —
  // a toolbar inline reaparece e não faz sentido manter o sheet aberto.
  useEffect(() => {
    if (!isMobile && filtersSheetOpen) setFiltersSheetOpen(false);
  }, [isMobile, filtersSheetOpen]);

  const activeFilterCount =
    (moduleFilter !== "__all" ? 1 : 0) +
    (areaFilter !== "__all" ? 1 : 0) +
    (statusFilter !== "__all" ? 1 : 0) +
    (assigneeFilter !== "__all" ? 1 : 0);

  const clearAllFilters = () => {
    setModuleFilter("__all");
    setAreaFilter("__all");
    setStatusFilter("__all");
    setAssigneeFilter("__all");
  };

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
      if (assigneeFilter !== "__all") {
        if (assigneeFilter === "__unassigned__") {
          if (t.assigneeIds.length > 0) return false;
        } else if (!t.assigneeIds.includes(assigneeFilter)) {
          return false;
        }
      }
      return true;
    });
  }, [tasks, stories, moduleFilter, areaFilter, statusFilter, assigneeFilter]);

  const showSprint = !!(sprints && onChangeSprint);
  const showMenu = !!(onDuplicate && onClone && onCopyRef && onDelete);

  const editing: RowEditingProps = {
    members,
    sprints,
    showSprint,
    showMenu,
    onOpenTask,
    onChangeStatus,
    onChangeAssignee,
    onChangeSprint,
    onDuplicate,
    onClone,
    onCopyRef,
    onDelete,
    bulkEnabled,
    selected,
    onToggleSelect: toggleOne,
  };

  const handleBulkDelete = () => {
    if (selectedRefs.length === 0) return;
    const count = selectedRefs.length;
    if (!confirm(`Deletar ${count} task${count > 1 ? "s" : ""}?`)) return;
    onBulkDelete?.(selectedRefs);
    clearSelection();
  };

  const handleBulkUpdate = (patch: {
    status?: TaskStatus;
    assigneeId?: string | null;
    sprintId?: string | null;
  }) => {
    if (selectedRefs.length === 0) return;
    onBulkUpdate?.(selectedRefs, patch);
    clearSelection();
  };

  return (
    <div className="space-y-4">
      {bulkEnabled && selected.size > 0 ? (
        <BulkActionsBar
          count={selected.size}
          onClear={clearSelection}
          members={members}
          sprints={sprints}
          onChangeStatus={(status) => handleBulkUpdate({ status })}
          onChangeAssignee={(assigneeId) => handleBulkUpdate({ assigneeId })}
          onChangeSprint={
            onChangeSprint
              ? (sprintId) => handleBulkUpdate({ sprintId })
              : undefined
          }
          onDuplicate={
            onBulkDuplicate
              ? () => {
                  onBulkDuplicate(selectedRefs);
                  clearSelection();
                }
              : undefined
          }
          onDelete={handleBulkDelete}
        />
      ) : null}

      {/* Toolbar ─────────────────────────────────────────────────────── */}
      <div className="flex flex-row flex-wrap items-center gap-2">
        {/* Desktop: filtros inline */}
        <div className="hidden flex-wrap gap-2 md:flex">
          <TasksFilters
            layout="inline"
            modules={modules}
            members={members}
            moduleFilter={moduleFilter}
            areaFilter={areaFilter}
            statusFilter={statusFilter}
            assigneeFilter={assigneeFilter}
            onModuleChange={setModuleFilter}
            onAreaChange={setAreaFilter}
            onStatusChange={setStatusFilter}
            onAssigneeChange={setAssigneeFilter}
          />
          {activeFilterCount > 0 && (
            <Button
              variant="ghost"
              size="sm"
              onClick={clearAllFilters}
              className="h-8 gap-1 text-xs text-muted-foreground hover:text-foreground"
            >
              <X className="h-3 w-3" />
              Limpar
            </Button>
          )}
        </div>

        {/* Mobile: trigger único pro bottom sheet */}
        <div className="flex items-center gap-2 md:hidden">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setFiltersSheetOpen(true)}
            className="h-8 gap-1.5"
          >
            <SlidersHorizontal className="size-3.5" />
            Filtros
            {activeFilterCount > 0 && (
              <Badge
                variant="secondary"
                className="ml-0.5 h-4 min-w-4 rounded-full px-1 text-[10px] font-mono tabular-nums"
              >
                {activeFilterCount}
              </Badge>
            )}
          </Button>
          {activeFilterCount > 0 && (
            <Button
              variant="ghost"
              size="sm"
              onClick={clearAllFilters}
              className="h-8 gap-1 text-xs text-muted-foreground hover:text-foreground"
              aria-label="Limpar filtros"
            >
              <X className="h-3 w-3" />
            </Button>
          )}
        </div>

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

      {/* Mobile filters bottom sheet ─────────────────────────────────── */}
      <Sheet open={filtersSheetOpen} onOpenChange={setFiltersSheetOpen}>
        <SheetContent
          side="bottom"
          className="max-h-[85dvh] rounded-t-xl"
        >
          <SheetHeader className="border-b pb-4">
            <SheetTitle className="text-base">
              Filtros
              {activeFilterCount > 0 && (
                <span className="ml-2 font-mono text-xs text-muted-foreground tabular-nums">
                  {activeFilterCount} ativo{activeFilterCount === 1 ? "" : "s"}
                </span>
              )}
            </SheetTitle>
          </SheetHeader>

          <div className="flex-1 overflow-y-auto px-6 pb-2">
            <TasksFilters
              layout="stacked"
              modules={modules}
              members={members}
              moduleFilter={moduleFilter}
              areaFilter={areaFilter}
              statusFilter={statusFilter}
              assigneeFilter={assigneeFilter}
              onModuleChange={setModuleFilter}
              onAreaChange={setAreaFilter}
              onStatusChange={setStatusFilter}
              onAssigneeChange={setAssigneeFilter}
            />
          </div>

          <div className="flex items-center justify-between gap-3 border-t p-4 pb-[max(env(safe-area-inset-bottom),1rem)]">
            <Button
              variant="ghost"
              onClick={clearAllFilters}
              disabled={activeFilterCount === 0}
              className="gap-1.5"
            >
              <X className="size-4" />
              Limpar tudo
            </Button>
            <Button onClick={() => setFiltersSheetOpen(false)}>
              Ver {filtered.length} task{filtered.length === 1 ? "" : "s"}
            </Button>
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}

// ─── Filters (shared between desktop inline + mobile sheet) ─────────────────

type TasksFiltersProps = {
  layout: "inline" | "stacked";
  modules: Module[];
  members: Member[];
  moduleFilter: string;
  areaFilter: string;
  statusFilter: string;
  assigneeFilter: string;
  onModuleChange: (v: string) => void;
  onAreaChange: (v: string) => void;
  onStatusChange: (v: string) => void;
  onAssigneeChange: (v: string) => void;
};

function TasksFilters({
  layout,
  modules,
  members,
  moduleFilter,
  areaFilter,
  statusFilter,
  assigneeFilter,
  onModuleChange,
  onAreaChange,
  onStatusChange,
  onAssigneeChange,
}: TasksFiltersProps) {
  const stacked = layout === "stacked";

  // Inline trigger: compact, "Label: value", flex-fit. Stacked: full-width with label above.
  const triggerCls = stacked
    ? "h-10 w-full text-sm"
    : "h-8 w-full min-w-[140px] flex-1 text-xs sm:w-[160px] sm:flex-none";

  const renderModule = (
    <Select value={moduleFilter} onValueChange={(v) => v && onModuleChange(v)}>
      <SelectTrigger className={triggerCls}>
        <SelectValue>
          {(v: string) => {
            if (stacked) {
              if (v === "__all") return "Todos";
              if (v === "null") return "Sem módulo";
              const mod = modules.find((m) => m.id === v);
              return mod?.name ?? "—";
            }
            if (v === "__all") return "Módulo: todos";
            if (v === "null") return "Módulo: sem módulo";
            const mod = modules.find((m) => m.id === v);
            return `Módulo: ${mod?.name ?? "—"}`;
          }}
        </SelectValue>
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
  );

  const renderArea = (
    <Select value={areaFilter} onValueChange={(v) => v && onAreaChange(v)}>
      <SelectTrigger className={triggerCls}>
        <SelectValue>
          {(v: string) => {
            const opt = AREA_OPTIONS.find(
              (o) => (o.value === null ? "null" : String(o.value)) === v,
            );
            if (stacked) {
              if (v === "__all") return "Todas";
              return opt?.label ?? "—";
            }
            if (v === "__all") return "Área: todas";
            return `Área: ${opt?.label ?? "—"}`;
          }}
        </SelectValue>
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
  );

  const renderStatus = (
    <Select value={statusFilter} onValueChange={(v) => v && onStatusChange(v)}>
      <SelectTrigger className={triggerCls}>
        <SelectValue>
          {(v: string) => {
            const opt = STATUS_OPTIONS.find((o) => String(o.value) === v);
            if (stacked) {
              if (v === "__all") return "Todos";
              return opt?.label ?? "—";
            }
            if (v === "__all") return "Status: todos";
            return `Status: ${opt?.label ?? "—"}`;
          }}
        </SelectValue>
      </SelectTrigger>
      <SelectContent>
        {STATUS_OPTIONS.map((opt) => (
          <SelectItem key={String(opt.value)} value={String(opt.value)}>
            {opt.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );

  const renderAssignee = (
    <Select
      value={assigneeFilter}
      onValueChange={(v) => v && onAssigneeChange(v)}
    >
      <SelectTrigger className={triggerCls}>
        <SelectValue>
          {(v: string) => {
            if (stacked) {
              if (v === "__all") return "Todos";
              if (v === "__unassigned__") return "Sem atribuição";
              const m = members.find((mb) => mb.id === v);
              return m?.name ?? "—";
            }
            if (v === "__all") return "Atribuído: todos";
            if (v === "__unassigned__") return "Atribuído: sem atribuição";
            const m = members.find((mb) => mb.id === v);
            return `Atribuído: ${m?.name ?? "—"}`;
          }}
        </SelectValue>
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="__all">Todos os membros</SelectItem>
        <SelectItem value="__unassigned__">— sem atribuição —</SelectItem>
        {members.map((m) => (
          <SelectItem key={m.id} value={m.id}>
            {m.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );

  if (stacked) {
    return (
      <div className="flex flex-col gap-4 py-4">
        <Field label="Módulo">{renderModule}</Field>
        <Field label="Área">{renderArea}</Field>
        <Field label="Status">{renderStatus}</Field>
        <Field label="Atribuído a">{renderAssignee}</Field>
      </div>
    );
  }

  return (
    <>
      {renderModule}
      {renderArea}
      {renderStatus}
      {renderAssignee}
    </>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
        {label}
      </Label>
      {children}
    </div>
  );
}

// ─── Grouped by story ────────────────────────────────────────────────────────

type RowEditingProps = {
  members: Member[];
  sprints?: SprintLite[];
  showSprint: boolean;
  showMenu: boolean;
  onOpenTask: (ref: string) => void;
  onChangeStatus?: (taskRef: string, status: TaskStatus) => void;
  onChangeAssignee?: (taskRef: string, memberId: string | null) => void;
  onChangeSprint?: (taskRef: string, sprintId: string | null) => void;
  onDuplicate?: (taskRef: string) => void;
  onClone?: (taskRef: string) => void;
  onCopyRef?: (taskRef: string) => void;
  onDelete?: (taskRef: string) => void;
  bulkEnabled: boolean;
  selected: Set<string>;
  onToggleSelect: (taskRef: string) => void;
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
    <section className="overflow-hidden rounded-xl border bg-card">
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
    <div className="overflow-hidden rounded-xl border bg-card">
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
  // Cols: [✓] · Ref · Title · [Story] · [Sprint] · Status · FP · Assignee · [⋯]
  //
  // Inline style instead of `grid-cols-[...]` because Tailwind only ships
  // classes that appear LITERALLY in source — runtime-built strings don't
  // make it to the CSS bundle, and the layout silently degrades to a
  // single-column stack.
  const layoutParts: string[] = [];
  if (editing.bulkEnabled) layoutParts.push("28px");
  layoutParts.push("110px", "minmax(220px, 1fr)");
  if (storyHint) layoutParts.push("200px");
  if (editing.showSprint) layoutParts.push("130px");
  layoutParts.push("130px", "70px", "150px");
  if (editing.showMenu) layoutParts.push("40px");
  const gridStyle = { gridTemplateColumns: layoutParts.join(" ") };

  // Min total width = sum of fixed columns + 220 (title min) + (col_count - 1) * 12px gap.
  const fixedSum =
    (editing.bulkEnabled ? 28 : 0) + 110 + 220
    + (storyHint ? 200 : 0) + (editing.showSprint ? 130 : 0)
    + 130 + 70 + 150 + (editing.showMenu ? 40 : 0);
  const colCount = layoutParts.length;
  const minWidthPx = fixedSum + (colCount - 1) * 12;

  // "Select all visible rows" header checkbox state. Toggles only rows in this
  // table block — selections from sibling story groups stay intact.
  const visibleRefs = rows.map((r) => r.reference);
  const selectedVisibleCount = visibleRefs.filter((r) =>
    editing.selected.has(r),
  ).length;
  const allVisibleSelected =
    visibleRefs.length > 0 && selectedVisibleCount === visibleRefs.length;
  const someVisibleSelected =
    selectedVisibleCount > 0 && selectedVisibleCount < visibleRefs.length;

  const toggleAllVisible = () => {
    if (allVisibleSelected) {
      visibleRefs.forEach((r) => {
        if (editing.selected.has(r)) editing.onToggleSelect(r);
      });
    } else {
      visibleRefs.forEach((r) => {
        if (!editing.selected.has(r)) editing.onToggleSelect(r);
      });
    }
  };

  return (
    <div className="overflow-x-auto">
      <div style={{ minWidth: `${minWidthPx}px` }}>
        {/* Header */}
        <div
          className="grid gap-3 border-b bg-muted/30 px-3 py-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground"
          style={gridStyle}
        >
          {editing.bulkEnabled ? (
            <span className="flex items-center" onClick={stop} onPointerDown={stop}>
              <input
                type="checkbox"
                checked={allVisibleSelected}
                ref={(el) => { if (el) el.indeterminate = someVisibleSelected; }}
                onChange={toggleAllVisible}
                aria-label="Selecionar todas"
                className="size-3.5 cursor-pointer rounded border-border accent-primary"
              />
            </span>
          ) : null}
          <span>Ref</span>
          <span>Título</span>
          {storyHint ? <span>Story</span> : null}
          {editing.showSprint ? <span>Sprint</span> : null}
          <span>Status</span>
          <span className="text-right">FP</span>
          <span className="text-right">Assignee</span>
          {editing.showMenu ? <span /> : null}
        </div>

        {/* Rows */}
        {rows.map((task, i) => {
          const hint = storyHint?.(task);
          const firstAssignee = task.assigneeIds[0] ?? null;
          const isLast = i === rows.length - 1;
          const isSelected = editing.selected.has(task.reference);

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
              className={`grid w-full cursor-pointer items-center gap-3 px-3 py-2.5 text-left text-sm transition-colors ${
                isSelected ? "bg-primary/5 hover:bg-primary/10" : "hover:bg-muted/40"
              } ${!isLast ? "border-b" : ""}`}
              style={gridStyle}
            >
              {editing.bulkEnabled ? (
                <span
                  className="flex items-center"
                  onClick={stop}
                  onPointerDown={stop}
                >
                  <input
                    type="checkbox"
                    checked={isSelected}
                    onChange={() => editing.onToggleSelect(task.reference)}
                    aria-label={`Selecionar ${task.reference}`}
                    className="size-3.5 cursor-pointer rounded border-border accent-primary"
                  />
                </span>
              ) : null}

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
                <span className="flex min-w-0 items-center gap-2 pr-2 text-muted-foreground">
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

              {editing.showMenu ? (
                <span className="flex justify-center">
                  <TaskRowMenu
                    taskRef={task.reference}
                    onDuplicate={editing.onDuplicate!}
                    onClone={editing.onClone!}
                    onCopyRef={editing.onCopyRef!}
                    onDelete={editing.onDelete!}
                  />
                </span>
              ) : null}
            </div>
          );
        })}
      </div>
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
      <SelectTrigger size="sm" className="h-7 w-full text-xs">
        <SelectValue placeholder="Ninguém">
          {(v: string | null) => {
            if (!v || v === ASSIGNEE_NONE) {
              return <span className="text-muted-foreground">Ninguém</span>;
            }
            return members.find((m) => m.id === v)?.name ?? "Ninguém";
          }}
        </SelectValue>
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
      <SelectTrigger size="sm" className="h-7 w-full text-xs">
        <SelectValue placeholder="Sem sprint">
          {(v: string | null) => {
            if (!v || v === SPRINT_NONE) {
              return <span className="text-muted-foreground">Sem sprint</span>;
            }
            return sprints.find((s) => s.id === v)?.name ?? "Sem sprint";
          }}
        </SelectValue>
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
