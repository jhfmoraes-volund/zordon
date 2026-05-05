"use client";

// MeetingTaskList — read-only "plan view" of MeetingTaskAction rows for a
// meeting/project. Visually inspired by TasksList from story-hierarchy
// (chips, sort, filters), but: rows are *proposals*, not tasks. Inline
// actions are Approve/Reject and "Open" (which delegates to the parent —
// caller decides which sheet to open).

import { useMemo, useState } from "react";
import { ArrowDown, ArrowUp, ChevronRight, Loader2, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { StatusChip } from "@/components/ui/status-chip";
import { ACTION_TYPE, lookupChip, type ChipTone } from "@/lib/status-chips";
import { TaskStatusChip } from "@/components/story-hierarchy";
import type {
  Member,
  Module,
  Story,
  Task,
  TaskTag,
} from "@/components/story-hierarchy";
import { sortTasks, type SortDir, type SortKey } from "@/components/story-hierarchy/sort";
import { TagChip, TagChipOverflow } from "@/components/tags/tag-chip";
import type { MeetingTaskAction } from "../meeting-task-action-sheet";
import type { ActionRow } from "./adapters";
import { MeetingBulkBar } from "./bulk-bar";

type SprintLite = { id: string; name: string };

export type MeetingTaskListProps = {
  rows: ActionRow[];
  stories: Story[];
  modules: Module[];
  members: Member[];
  sprints: SprintLite[];
  availableTags: TaskTag[];

  onOpenAction: (action: MeetingTaskAction) => void;
  onApprove: (id: string) => Promise<void>;
  onReject: (id: string) => Promise<void>;
  onBulkApprove?: (ids: string[]) => Promise<void>;
  onBulkReject?: (ids: string[]) => Promise<void>;
};

type ActionTypeFilter = "__all" | MeetingTaskAction["type"];

const DECISION_LABEL: Record<MeetingTaskAction["decision"], string> = {
  pending: "Pendente",
  approved: "Aprovada",
  rejected: "Rejeitada",
};
const DECISION_TONE: Record<MeetingTaskAction["decision"], ChipTone> = {
  pending: "amber",
  approved: "green",
  rejected: "muted",
};

const DECISION_ORDER: Record<MeetingTaskAction["decision"], number> = {
  pending: 0,
  approved: 1,
  rejected: 2,
};

export function MeetingTaskList({
  rows,
  stories,
  modules: _modules,
  members,
  sprints,
  availableTags,
  onOpenAction,
  onApprove,
  onReject,
  onBulkApprove,
  onBulkReject,
}: MeetingTaskListProps) {
  const [actionFilter, setActionFilter] = useState<ActionTypeFilter>("__all");
  const [tagFilter, setTagFilter] = useState<string>("__all");
  const [assigneeFilter, setAssigneeFilter] = useState<string>("__all");
  const [sortKey, setSortKey] = useState<SortKey | null>(null);
  const [sortDir, setSortDir] = useState<SortDir>("asc");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busyIds, setBusyIds] = useState<Set<string>>(new Set());

  const handleSort = (key: SortKey) => {
    if (sortKey !== key) {
      setSortKey(key);
      setSortDir("asc");
      return;
    }
    if (sortDir === "asc") {
      setSortDir("desc");
      return;
    }
    setSortKey(null);
    setSortDir("asc");
  };

  const filtered = useMemo(() => {
    return rows.filter((r) => {
      if (actionFilter !== "__all" && r.action.type !== actionFilter) return false;
      if (tagFilter !== "__all") {
        if (tagFilter === "__none") {
          if (r.task.tags.length > 0) return false;
        } else if (!r.task.tags.some((t) => t.id === tagFilter)) {
          return false;
        }
      }
      if (assigneeFilter !== "__all") {
        if (assigneeFilter === "__unassigned") {
          if (r.task.assigneeIds.length > 0) return false;
        } else if (!r.task.assigneeIds.includes(assigneeFilter)) {
          return false;
        }
      }
      return true;
    });
  }, [rows, actionFilter, tagFilter, assigneeFilter]);

  // Sort within each decision group below; here we keep the input order
  // by-decision then apply sort to the task fields if any.
  const grouped = useMemo(() => {
    const buckets: Record<MeetingTaskAction["decision"], ActionRow[]> = {
      pending: [],
      approved: [],
      rejected: [],
    };
    for (const r of filtered) buckets[r.action.decision].push(r);

    if (sortKey) {
      for (const k of Object.keys(buckets) as Array<MeetingTaskAction["decision"]>) {
        const tasks = buckets[k].map((r) => r.task as Task);
        const sorted = sortTasks(tasks, sortKey, sortDir, { stories, sprints, members });
        // re-map back to rows preserving the action wrapper
        const taskToRow = new Map(buckets[k].map((r) => [r.task as Task, r] as const));
        buckets[k] = sorted
          .map((t) => taskToRow.get(t))
          .filter((r): r is ActionRow => !!r);
      }
    }
    return buckets;
  }, [filtered, sortKey, sortDir, stories, sprints, members]);

  const toggleOne = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };
  const clearSelection = () => setSelected(new Set());

  const wrapBusy = async (id: string, fn: () => Promise<void>) => {
    setBusyIds((prev) => new Set(prev).add(id));
    try {
      await fn();
    } finally {
      setBusyIds((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    }
  };

  const pendingIds = useMemo(
    () => filtered.filter((r) => r.action.decision === "pending").map((r) => r.action.id),
    [filtered],
  );

  const selectedPending = useMemo(
    () => Array.from(selected).filter((id) => pendingIds.includes(id)),
    [selected, pendingIds],
  );

  const handleBulkApprove = async () => {
    if (!onBulkApprove || selectedPending.length === 0) return;
    await onBulkApprove(selectedPending);
    clearSelection();
  };
  const handleBulkReject = async () => {
    if (!onBulkReject || selectedPending.length === 0) return;
    await onBulkReject(selectedPending);
    clearSelection();
  };

  return (
    <div className="space-y-3">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <FilterSelect
          value={actionFilter}
          onChange={(v) => setActionFilter(v as ActionTypeFilter)}
          options={[
            { value: "__all", label: "Todos tipos" },
            { value: "create", label: "Criar" },
            { value: "update", label: "Atualizar" },
            { value: "move", label: "Mover" },
            { value: "delete", label: "Remover" },
            { value: "review", label: "Revisar" },
          ]}
        />
        <FilterSelect
          value={assigneeFilter}
          onChange={setAssigneeFilter}
          options={[
            { value: "__all", label: "Todos assignees" },
            { value: "__unassigned", label: "Sem assignee" },
            ...members.map((m) => ({ value: m.id, label: m.name })),
          ]}
        />
        {availableTags.length > 0 && (
          <FilterSelect
            value={tagFilter}
            onChange={setTagFilter}
            options={[
              { value: "__all", label: "Todas tags" },
              { value: "__none", label: "Sem tag" },
              ...availableTags.map((t) => ({ value: t.id, label: t.name })),
            ]}
          />
        )}
        {(actionFilter !== "__all" || tagFilter !== "__all" || assigneeFilter !== "__all") && (
          <Button
            variant="ghost"
            size="sm"
            className="h-7 px-2 text-xs text-muted-foreground"
            onClick={() => {
              setActionFilter("__all");
              setTagFilter("__all");
              setAssigneeFilter("__all");
            }}
          >
            Limpar filtros
          </Button>
        )}
      </div>

      {/* Empty state */}
      {filtered.length === 0 && (
        <div className="surface-inset p-6 text-center text-sm text-muted-foreground">
          Nenhuma proposta. Use <strong>Sugerir com IA</strong> ou crie manualmente.
        </div>
      )}

      {/* Decision-grouped sections */}
      {filtered.length > 0 && (
        <div className="surface overflow-hidden">
          <ListHeader
            sortKey={sortKey}
            sortDir={sortDir}
            onSort={handleSort}
            bulkEnabled={!!(onBulkApprove || onBulkReject)}
          />
          {(["pending", "approved", "rejected"] as MeetingTaskAction["decision"][]).map(
            (decision) =>
              grouped[decision].length === 0 ? null : (
                <div key={decision}>
                  <DecisionBanner
                    decision={decision}
                    count={grouped[decision].length}
                  />
                  {grouped[decision].map((row) => (
                    <Row
                      key={row.action.id}
                      row={row}
                      stories={stories}
                      sprints={sprints}
                      members={members}
                      busy={busyIds.has(row.action.id)}
                      bulkEnabled={!!(onBulkApprove || onBulkReject)}
                      selected={selected.has(row.action.id)}
                      onToggleSelect={() => toggleOne(row.action.id)}
                      onOpen={() => onOpenAction(row.action)}
                      onApprove={() =>
                        wrapBusy(row.action.id, () => onApprove(row.action.id))
                      }
                      onReject={() =>
                        wrapBusy(row.action.id, () => onReject(row.action.id))
                      }
                    />
                  ))}
                </div>
              ),
          )}
        </div>
      )}

      {selectedPending.length > 0 && (
        <MeetingBulkBar
          count={selectedPending.length}
          onApprove={onBulkApprove ? handleBulkApprove : undefined}
          onReject={onBulkReject ? handleBulkReject : undefined}
          onClear={clearSelection}
        />
      )}
    </div>
  );
}

// ─── Sub components ───────────────────────────────────────────────────────────

function ListHeader({
  sortKey,
  sortDir,
  onSort,
  bulkEnabled,
}: {
  sortKey: SortKey | null;
  sortDir: SortDir;
  onSort: (k: SortKey) => void;
  bulkEnabled: boolean;
}) {
  return (
    <div
      className="grid items-center gap-3 border-b bg-muted/30 px-3 py-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground"
      style={GRID_STYLE}
    >
      {bulkEnabled ? <span /> : null}
      <span>Ação</span>
      <SortHead k="ref" label="Ref" sortKey={sortKey} sortDir={sortDir} onSort={onSort} />
      <SortHead k="title" label="Título" sortKey={sortKey} sortDir={sortDir} onSort={onSort} />
      <SortHead k="story" label="Story" sortKey={sortKey} sortDir={sortDir} onSort={onSort} />
      <SortHead k="sprint" label="Sprint" sortKey={sortKey} sortDir={sortDir} onSort={onSort} />
      <SortHead k="status" label="Status" sortKey={sortKey} sortDir={sortDir} onSort={onSort} />
      <SortHead k="assignee" label="Assignee" sortKey={sortKey} sortDir={sortDir} onSort={onSort} />
      <span className="text-right" />
    </div>
  );
}

function DecisionBanner({
  decision,
  count,
}: {
  decision: MeetingTaskAction["decision"];
  count: number;
}) {
  return (
    <div className="flex items-center gap-2 border-b bg-background px-3 py-1.5 text-xs">
      <StatusChip
        tone={DECISION_TONE[decision]}
        label={DECISION_LABEL[decision]}
      />
      <span className="text-muted-foreground">
        ({count})
      </span>
    </div>
  );
}

function Row({
  row,
  stories,
  sprints,
  members,
  busy,
  bulkEnabled,
  selected,
  onToggleSelect,
  onOpen,
  onApprove,
  onReject,
}: {
  row: ActionRow;
  stories: Story[];
  sprints: SprintLite[];
  members: Member[];
  busy: boolean;
  bulkEnabled: boolean;
  selected: boolean;
  onToggleSelect: () => void;
  onOpen: () => void;
  onApprove: () => Promise<void>;
  onReject: () => Promise<void>;
}) {
  const { action, task, displaySprintId, originalSprintId, changedFields, strikethrough } = row;
  const story = task.userStoryRef
    ? stories.find((s) => s.reference === task.userStoryRef)
    : null;
  const displaySprint = displaySprintId
    ? sprints.find((s) => s.id === displaySprintId)
    : null;
  const originalSprint = originalSprintId
    ? sprints.find((s) => s.id === originalSprintId)
    : null;
  const firstAssignee = task.assigneeIds[0] ?? null;
  const assigneeName = firstAssignee
    ? members.find((m) => m.id === firstAssignee)?.name ?? null
    : null;

  const actionChip = lookupChip(ACTION_TYPE, action.type);
  const isPending = action.decision === "pending";
  const isPendingExec = action.decision === "approved" && action.execution === "pending";

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
      className="grid w-full cursor-pointer items-center gap-3 border-b px-3 py-2.5 text-sm transition-colors hover:bg-muted/40 last:border-b-0"
      style={GRID_STYLE}
    >
      {bulkEnabled ? (
        <span
          className="flex items-center"
          onClick={(e) => e.stopPropagation()}
          onPointerDown={(e) => e.stopPropagation()}
        >
          <input
            type="checkbox"
            checked={selected}
            onChange={onToggleSelect}
            disabled={!isPending}
            aria-label={`Selecionar ${task.reference}`}
            className="size-3.5 cursor-pointer rounded border-border accent-primary disabled:cursor-not-allowed disabled:opacity-30"
          />
        </span>
      ) : null}

      <span className="flex items-center gap-1.5">
        <StatusChip tone={actionChip.tone} label={actionChip.label} />
        {action.source === "ai" && (
          <Sparkles className="size-3 shrink-0 text-amber-500/80" />
        )}
      </span>

      <span className="font-mono text-xs text-muted-foreground truncate">
        {task.reference}
      </span>

      <span className="flex min-w-0 items-center gap-2">
        <span
          className={`truncate ${strikethrough ? "line-through text-muted-foreground" : ""} ${
            changedFields.has("title") ? "italic" : ""
          }`}
        >
          {task.title}
        </span>
        {task.tags.length > 0 && (
          <span className="flex shrink-0 items-center gap-1">
            {task.tags.slice(0, 2).map((tg) => (
              <TagChip
                key={tg.id}
                name={tg.name}
                tone={tg.tone as ChipTone}
                variant="linear"
                size="sm"
              />
            ))}
            <TagChipOverflow
              count={Math.max(0, task.tags.length - 2)}
              variant="linear"
              size="sm"
            />
          </span>
        )}
      </span>

      <span className="text-xs text-muted-foreground truncate">
        {story ? (
          <span className="font-mono">{story.reference}</span>
        ) : (
          <span className="opacity-50">—</span>
        )}
      </span>

      <span className="text-xs text-muted-foreground truncate">
        {action.type === "move" && originalSprint && displaySprint ? (
          <span className="inline-flex items-center gap-1">
            <span>{originalSprint.name}</span>
            <ChevronRight className="size-3" />
            <span className="font-medium text-foreground">{displaySprint.name}</span>
          </span>
        ) : displaySprint ? (
          displaySprint.name
        ) : (
          <span className="opacity-50">—</span>
        )}
      </span>

      <span>
        <TaskStatusChip status={task.status} />
      </span>

      <span className="text-xs text-muted-foreground truncate">
        {assigneeName ?? <span className="opacity-50">—</span>}
      </span>

      <span
        className="flex items-center justify-end gap-1"
        onClick={(e) => e.stopPropagation()}
      >
        {action.decision === "approved" && action.execution === "applied" && (
          <StatusChip tone="green" label="Aplicada" />
        )}
        {action.decision === "approved" && action.execution === "failed" && (
          <StatusChip tone="red" label="Falhou" />
        )}
        {isPending && (
          <>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 px-2 text-xs text-green-700"
              disabled={busy}
              onClick={onApprove}
            >
              {busy ? <Loader2 className="size-3 animate-spin" /> : "Aprovar"}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 px-2 text-xs text-red-700"
              disabled={busy}
              onClick={onReject}
            >
              Rejeitar
            </Button>
          </>
        )}
        <Button variant="outline" size="sm" className="h-7 px-2 text-xs" onClick={onOpen}>
          Abrir
        </Button>
      </span>
    </div>
  );
}

function SortHead({
  k,
  label,
  sortKey,
  sortDir,
  onSort,
  align = "left",
}: {
  k: SortKey;
  label: string;
  sortKey: SortKey | null;
  sortDir: SortDir;
  onSort: (k: SortKey) => void;
  align?: "left" | "right";
}) {
  const active = sortKey === k;
  return (
    <button
      type="button"
      onClick={() => onSort(k)}
      className={`inline-flex items-center gap-1 ${align === "right" ? "justify-end" : ""} hover:text-foreground transition-colors`}
    >
      <span>{label}</span>
      {active &&
        (sortDir === "asc" ? (
          <ArrowUp className="size-3" />
        ) : (
          <ArrowDown className="size-3" />
        ))}
    </button>
  );
}

function FilterSelect({
  value,
  onChange,
  options,
}: {
  value: string;
  onChange: (v: string) => void;
  options: Array<{ value: string; label: string }>;
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="h-7 rounded-md border border-border bg-background px-2 text-xs"
    >
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

// 8 cols (no bulk) or 9 (bulk): [bulk?] action ref title story sprint status assignee actions
//
// Title gets the lion's share (3fr); story/sprint stay tight (max-content) so
// "—" placeholders don't waste space. Status uses 110px fixed to fit the
// largest TaskStatusChip ("In progress") without jitter.
const GRID_STYLE: React.CSSProperties = {
  gridTemplateColumns:
    "auto 92px 70px minmax(200px, 3fr) minmax(56px, max-content) minmax(80px, max-content) 110px minmax(90px, 1fr) auto",
};

// Re-export adapter types for callers
export type { ActionRow, RawTaskForRow, RowTask } from "./adapters";
export { actionToRow, buildStoryRefMap } from "./adapters";
