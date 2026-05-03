"use client";

import { useEffect, useMemo, useState } from "react";
import { useFieldDebounce } from "@/hooks/use-field-debounce";
import { ChevronDown, ChevronRight, Sparkles, X } from "lucide-react";
import {
  ResponsiveSheet,
  ResponsiveSheetBody,
  ResponsiveSheetContent,
  ResponsiveSheetHeader,
  ResponsiveSheetTitle,
} from "@/components/ui/responsive-sheet";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { StatusChipSelect } from "@/components/ui/status-chip-select";
import { TASK_STATUS } from "@/lib/status-chips";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { suggestFunctionPoints } from "@/lib/function-points";
import { AcList } from "./ac-list";
import { TaskFeed } from "./task-feed";
import type {
  Member,
  Module,
  Story,
  Task,
  TaskComplexity,
  TaskScope,
  TaskStatus,
  TaskTag,
  TaskType,
} from "./types";
import { TagPicker, type TagPickerOption } from "@/components/tags/tag-picker";
import type { ChipTone } from "@/lib/status-chips";

type SprintLite = {
  id: string;
  name: string;
  status?: string;
};

/** Stories used by TaskSheet. */
type StoryWithMaybeDbId = Story & { __id?: string };

type TaskSheetProps = {
  task: Task | null;
  stories: StoryWithMaybeDbId[];
  modules: Module[];
  members: Member[];
  definitionOfDone: string[];
  onClose: () => void;
  /** Persist a Task patch (called per-field, with the merged Task). */
  onSave: (updated: Task) => void | Promise<void>;
  /** Open the parent story when breadcrumb is clicked. */
  onOpenStory?: (storyRef: string) => void;
  /** Sprint picker support. When omitted, the row is read-only. */
  sprints?: SprintLite[];
  onChangeSprint?: (taskRef: string, sprintId: string | null) => void | Promise<void>;
  /** Multi-assignee toggle. When omitted, assignees become read-only. */
  onChangeAssignees?: (taskRef: string, memberIds: string[]) => void | Promise<void>;
  /** Project-wide tag list. When omitted, the picker still works in display-
   *  only mode (selected tags remain visible). */
  availableTags?: TaskTag[];
  /** Create a new tag in the project (project-scoped). Required for the
   *  create-on-the-fly affordance in the picker. */
  onCreateTag?: (name: string, tone: ChipTone) => Promise<TaskTag>;
  /** Replace the task's tag set with the given ids. */
  onChangeTags?: (taskRef: string, tagIds: string[]) => void | Promise<void>;
  /** Create an acceptance criterion. Optimistic apply happens in the caller. */
  onAcCreate?: (
    taskRef: string,
    text: string,
    order: number,
  ) => Promise<void>;
  /** Persist a text edit on an existing AC. */
  onAcUpdateText?: (
    taskRef: string,
    acId: string,
    text: string,
  ) => Promise<void>;
  /** Toggle the checked state of an AC. */
  onAcToggle?: (
    taskRef: string,
    acId: string,
    checked: boolean,
  ) => Promise<void>;
  /** Remove an AC. */
  onAcDelete?: (taskRef: string, acId: string) => Promise<void>;
};

function tagsToOptions(tags: TaskTag[]): TagPickerOption[] {
  return tags.map((t) => ({
    id: t.id,
    name: t.name,
    tone: t.tone as ChipTone,
  }));
}

const TYPE_VALUES: TaskType[] = [
  "feature",
  "bugfix",
  "refactor",
  "setup",
  "component",
  "seed",
  "management",
];
const SCOPE_VALUES: TaskScope[] = ["micro", "small", "medium", "large"];
const COMPLEXITY_VALUES: TaskComplexity[] = [
  "trivial",
  "low",
  "medium",
  "high",
];

export function TaskSheet(props: TaskSheetProps) {
  const { task, onClose } = props;
  return (
    <ResponsiveSheet
      open={task !== null}
      onOpenChange={(open) => !open && onClose()}
    >
      <ResponsiveSheetContent size="lg" showCloseButton={false}>
        {task ? <TaskSheetInner {...props} task={task} /> : null}
      </ResponsiveSheetContent>
    </ResponsiveSheet>
  );
}

// ─── Breadcrumb ──────────────────────────────────────────────────────────────

function Breadcrumb({
  task,
  stories,
  modules,
  onOpenStory,
}: {
  task: Task;
  stories: Story[];
  modules: Module[];
  onOpenStory?: (ref: string) => void;
}) {
  const story = stories.find((s) => s.reference === task.userStoryRef) ?? null;
  const mod = story ? modules.find((m) => m.id === story.moduleId) : null;
  return (
    <div className="flex items-center gap-1 text-[10px] text-muted-foreground">
      {mod ? (
        <Badge variant="outline" className="font-mono text-[10px]">
          {mod.name}
        </Badge>
      ) : null}
      {story ? (
        <>
          <ChevronRight className="size-3" />
          <button
            type="button"
            onClick={() => onOpenStory?.(story.reference)}
            className="font-mono hover:text-foreground hover:underline"
          >
            {story.reference}
          </button>
        </>
      ) : null}
      <ChevronRight className="size-3" />
      <span className="font-mono">{task.reference}</span>
    </div>
  );
}

// ─── Inner: always-editable task body ────────────────────────────────────────

export function TaskSheetInner({
  task,
  stories,
  modules,
  members,
  sprints,
  onClose,
  onSave,
  onOpenStory,
  onChangeSprint,
  onChangeAssignees,
  availableTags,
  onCreateTag,
  onChangeTags,
  onAcCreate,
  onAcUpdateText,
  onAcToggle,
  onAcDelete,
}: TaskSheetProps & { task: Task }) {
  // Local drafts for text/number fields (saved on blur).
  const [title, setTitle] = useState(task.title);
  const [description, setDescription] = useState(task.description ?? "");
  const [notes, setNotes] = useState(task.notes ?? "");
  const [fp, setFp] = useState<number>(task.functionPoints);
  const [fpManual, setFpManual] = useState(false);

  // Reset drafts when the user opens a different task.
  useEffect(() => {
    setTitle(task.title);
    setDescription(task.description ?? "");
    setNotes(task.notes ?? "");
    setFp(task.functionPoints);
    setFpManual(false);
  }, [task.reference, task.title, task.description, task.notes, task.functionPoints]);

  function persist(patch: Partial<Task>) {
    onSave({ ...task, ...patch });
  }

  /** Persist text only if changed (avoid spurious updates on blur). */
  function persistIfChanged<K extends keyof Task>(field: K, value: Task[K]) {
    if (value === task[field]) return;
    persist({ [field]: value } as Partial<Task>);
  }

  // Coalesce repeated blurs on free-text fields so re-focusing doesn't spam
  // the audit trail with identical edits.
  const { schedule: scheduleTextPersist } = useFieldDebounce(2_000);
  function persistTextDebounced<K extends keyof Task>(
    field: K,
    value: Task[K],
  ) {
    scheduleTextPersist(String(field), () =>
      persistIfChanged(field, value),
    );
  }

  // ─── AC handlers (each persists individually with optimistic apply) ──────
  async function handleAcTextCommit(id: string, text: string) {
    if (!onAcUpdateText) return;
    await onAcUpdateText(task.reference, id, text);
  }
  async function handleAcToggle(id: string, checked: boolean) {
    if (!onAcToggle) return;
    await onAcToggle(task.reference, id, checked);
  }
  async function handleAcRemove(id: string) {
    if (!onAcDelete) return;
    await onAcDelete(task.reference, id);
  }
  async function handleAcAdd() {
    if (!onAcCreate) return;
    await onAcCreate(task.reference, "", task.acceptanceCriteria.length);
  }

  function toggleAssignee(memberId: string) {
    if (!onChangeAssignees) return;
    const next = task.assigneeIds.includes(memberId)
      ? task.assigneeIds.filter((x) => x !== memberId)
      : [...task.assigneeIds, memberId];
    onChangeAssignees(task.reference, next);
  }

  // Stories grouped by module for the user-story picker.
  const storiesByModule = useMemo(() => {
    return modules.map((m) => ({
      module: m,
      rows: stories.filter((s) => s.moduleId === m.id),
    }));
  }, [stories, modules]);

  return (
    <>
      <ResponsiveSheetHeader>
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0 flex-1 space-y-2">
            <Breadcrumb
              task={task}
              stories={stories}
              modules={modules}
              onOpenStory={onOpenStory}
            />
            <ResponsiveSheetTitle className="sr-only">
              {title || "Título da task"}
            </ResponsiveSheetTitle>
            <textarea
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              onBlur={() => persistTextDebounced("title", title)}
              rows={1}
              className="block w-full resize-none bg-transparent font-heading font-semibold leading-snug text-foreground outline-none placeholder:text-muted-foreground field-sizing-content"
              style={{
                border: 0,
                margin: 0,
                padding: 0,
                boxShadow: "none",
                minHeight: 0,
                fontSize: "1.322rem",
              }}
              placeholder="Título da task"
            />
            {task.createdByAgent ? (
              <div className="flex items-center text-[10px]">
                <span className="ml-auto inline-flex items-center gap-1 uppercase tracking-wider text-muted-foreground">
                  <Sparkles className="size-3" /> Alpha
                </span>
              </div>
            ) : null}
          </div>
          <Button
            size="icon-sm"
            variant="ghost"
            onClick={onClose}
            aria-label="Fechar"
          >
            <X />
          </Button>
        </div>
      </ResponsiveSheetHeader>

      <ResponsiveSheetBody className="space-y-5">
        {/* Status + Assignees */}
        <div className="grid grid-cols-2 gap-3 items-start">
          <FieldBlock label="Status">
            <StatusChipSelect
              variant="input"
              value={task.status}
              options={TASK_STATUS}
              onValueChange={(v) => persist({ status: v as TaskStatus })}
            />
          </FieldBlock>

          {onChangeAssignees ? (
            <FieldBlock label="Assignees">
              <DropdownMenu>
                <DropdownMenuTrigger
                  className="flex h-9 w-full items-center justify-between gap-1.5 rounded-lg border border-input bg-transparent px-2.5 text-sm transition-colors outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30 dark:hover:bg-input/50"
                >
                  {(() => {
                    const selected = members.filter((m) =>
                      task.assigneeIds.includes(m.id),
                    );
                    if (selected.length === 0) {
                      return (
                        <span className="text-muted-foreground">
                          Sem assignee
                        </span>
                      );
                    }
                    return (
                      <span className="flex min-w-0 flex-1 items-center gap-1.5">
                        <span className="truncate">
                          {selected.map((m) => m.name).join(", ")}
                        </span>
                        {selected.length > 1 ? (
                          <Badge variant="outline" className="h-4 px-1 text-[9px] font-mono">
                            {selected.length}
                          </Badge>
                        ) : null}
                      </span>
                    );
                  })()}
                  <ChevronDown className="size-4 shrink-0 text-muted-foreground" />
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="min-w-[var(--anchor-width)]">
                  {members.length === 0 ? (
                    <div className="px-1.5 py-1.5 text-xs text-muted-foreground">
                      Nenhum membro alocado ao projeto.
                    </div>
                  ) : (
                    members.map((m) => (
                      <DropdownMenuCheckboxItem
                        key={m.id}
                        checked={task.assigneeIds.includes(m.id)}
                        onCheckedChange={() => toggleAssignee(m.id)}
                      >
                        {m.name}
                      </DropdownMenuCheckboxItem>
                    ))
                  )}
                </DropdownMenuContent>
              </DropdownMenu>
            </FieldBlock>
          ) : null}
        </div>

        <FieldBlock label="Tags">
          <TagPicker
            available={tagsToOptions(availableTags ?? task.tags)}
            selectedIds={task.tags.map((t) => t.id)}
            onChange={(ids) => onChangeTags?.(task.reference, ids)}
            onCreate={async (name, tone) => {
              if (!onCreateTag) {
                return { id: `tmp-${Date.now()}`, name, tone };
              }
              const created = await onCreateTag(name, tone);
              return { id: created.id, name: created.name, tone: created.tone as ChipTone };
            }}
            variant="linear"
            triggerVisibleCount={99}
          />
        </FieldBlock>

        {/* User Story */}
        <FieldBlock label="User Story">
          <Select
            value={task.userStoryRef ?? "__none"}
            onValueChange={(v) => {
              if (v === null) return;
              persist({ userStoryRef: v === "__none" ? null : v });
            }}
          >
            <SelectTrigger className="w-full h-9">
              <SelectValue placeholder="Sem story">
                {(v: string | null) => {
                  if (!v || v === "__none") {
                    return (
                      <span className="text-muted-foreground">Sem story</span>
                    );
                  }
                  const story = stories.find((s) => s.reference === v);
                  if (!story) return v;
                  return (
                    <span className="flex items-center gap-2">
                      <span className="font-mono text-[10px] text-muted-foreground">
                        {story.reference}
                      </span>
                      <span className="truncate">{story.title}</span>
                    </span>
                  );
                }}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__none">— sem story —</SelectItem>
              {storiesByModule.map((g) =>
                g.rows.length === 0 ? null : (
                  <div key={g.module.id}>
                    <div className="px-2 py-1 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                      {g.module.name}
                    </div>
                    {g.rows.map((s) => (
                      <SelectItem key={s.reference} value={s.reference}>
                        <span className="flex items-center gap-2">
                          <span className="font-mono text-[10px] text-muted-foreground">
                            {s.reference}
                          </span>
                          <span className="truncate">{s.title}</span>
                        </span>
                      </SelectItem>
                    ))}
                  </div>
                ),
              )}
            </SelectContent>
          </Select>
        </FieldBlock>

        {/* Sprint (only when callback wired) */}
        {sprints && onChangeSprint ? (
          <FieldBlock label="Sprint">
            <Select
              value={task.sprintId ?? "__none"}
              onValueChange={(v) => {
                if (v === null) return;
                onChangeSprint(
                  task.reference,
                  v === "__none" ? null : v,
                );
              }}
            >
              <SelectTrigger className="w-full h-9">
                <SelectValue placeholder="Sem sprint">
                  {(v: string | null) => {
                    if (!v || v === "__none") {
                      return (
                        <span className="text-muted-foreground">Sem sprint</span>
                      );
                    }
                    return sprints.find((s) => s.id === v)?.name ?? "Sem sprint";
                  }}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__none">— sem sprint —</SelectItem>
                {sprints.map((s) => (
                  <SelectItem key={s.id} value={s.id}>
                    {s.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </FieldBlock>
        ) : null}

        {/* Scope + Complexity */}
        <div className="grid grid-cols-2 gap-3">
          <FieldBlock label="Scope">
            <Select
              value={task.scope}
              onValueChange={(v) => {
                if (v === null) return;
                const next = { scope: v as TaskScope };
                if (!fpManual) {
                  const newFp = suggestFunctionPoints(next.scope, task.complexity);
                  setFp(newFp);
                  persist({ ...next, functionPoints: newFp });
                } else {
                  persist(next);
                }
              }}
            >
              <SelectTrigger className="w-full h-9"><SelectValue /></SelectTrigger>
              <SelectContent>
                {SCOPE_VALUES.map((s) => (
                  <SelectItem key={s} value={s}>{s}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </FieldBlock>

          <FieldBlock label="Complexity">
            <Select
              value={task.complexity}
              onValueChange={(v) => {
                if (v === null) return;
                const next = { complexity: v as TaskComplexity };
                if (!fpManual) {
                  const newFp = suggestFunctionPoints(task.scope, next.complexity);
                  setFp(newFp);
                  persist({ ...next, functionPoints: newFp });
                } else {
                  persist(next);
                }
              }}
            >
              <SelectTrigger className="w-full h-9"><SelectValue /></SelectTrigger>
              <SelectContent>
                {COMPLEXITY_VALUES.map((c) => (
                  <SelectItem key={c} value={c}>{c}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </FieldBlock>
        </div>

        {/* Function Points + Tipo */}
        <div className="grid grid-cols-2 gap-3 items-start">
          <FieldBlock label="Function Points">
            <Input
              type="number"
              min={1}
              value={fp}
              onChange={(e) => {
                setFpManual(true);
                setFp(Number(e.target.value) || 1);
              }}
              onBlur={() => persistIfChanged("functionPoints", fp)}
              className="h-9"
            />
            {fpManual ? (
              <button
                type="button"
                onClick={() => {
                  const newFp = suggestFunctionPoints(task.scope, task.complexity);
                  setFp(newFp);
                  setFpManual(false);
                  persist({ functionPoints: newFp });
                }}
                className="text-left text-[10px] text-muted-foreground hover:text-foreground hover:underline"
              >
                Voltar pra matriz {task.scope} × {task.complexity}
              </button>
            ) : (
              <span className="text-[10px] text-muted-foreground">
                Sugerido pela matriz {task.scope} × {task.complexity}
              </span>
            )}
          </FieldBlock>

          <FieldBlock label="Tipo">
            <Select
              value={task.type}
              onValueChange={(v) =>
                v !== null && persist({ type: v as TaskType })
              }
            >
              <SelectTrigger className="w-full h-9"><SelectValue /></SelectTrigger>
              <SelectContent>
                {TYPE_VALUES.map((t) => (
                  <SelectItem key={t} value={t}>{t}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </FieldBlock>
        </div>

        <Separator />

        <AcList
          mode="editPersisted"
          items={task.acceptanceCriteria}
          onToggle={handleAcToggle}
          onTextCommit={handleAcTextCommit}
          onAdd={handleAcAdd}
          onRemove={handleAcRemove}
        />

        <Separator />

        {/* Description + Notes — inline, save on blur */}
        <FieldBlock label="Descrição">
          <Textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            onBlur={() =>
              persistTextDebounced(
                "description",
                description.trim() === "" ? null : description,
              )
            }
            placeholder="O que entregar e por quê"
            rows={3}
            className="text-sm"
          />
        </FieldBlock>

        <FieldBlock label="Notas">
          <Textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            onBlur={() =>
              persistTextDebounced(
                "notes",
                notes.trim() === "" ? null : notes,
              )
            }
            placeholder="Snippets, queries, referências, observações técnicas…"
            rows={4}
            className="font-mono text-sm"
          />
        </FieldBlock>

        {(() => {
          const dbTaskId = (task as Task & { __id?: string }).__id ?? null;
          if (!dbTaskId) return null;
          return (
            <TaskFeed
              taskId={dbTaskId}
              ctx={{
                members,
                sprints: sprints ?? [],
                stories,
                projectTags: availableTags ?? [],
              }}
              members={members}
            />
          );
        })()}
      </ResponsiveSheetBody>
    </>
  );
}

// ─── Layout primitives ───────────────────────────────────────────────────────

function FieldBlock({
  label,
  children,
  className,
}: {
  label: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={`space-y-1.5 ${className ?? ""}`}>
      <Label className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
        {label}
      </Label>
      {children}
    </div>
  );
}
