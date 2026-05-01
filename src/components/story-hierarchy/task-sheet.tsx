"use client";

import { useEffect, useMemo, useState } from "react";
import { ChevronDown, ChevronRight, Sparkles, X } from "lucide-react";
import {
  ResponsiveSheet,
  ResponsiveSheetBody,
  ResponsiveSheetContent,
  ResponsiveSheetFooter,
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
import { TASK_STATUS_MAP } from "./chips";
import { AcList } from "./ac-list";
import { TaskActivitySection } from "./task-activity-section";
import type {
  AC,
  Member,
  Module,
  Story,
  Task,
  TaskArea,
  TaskComplexity,
  TaskScope,
  TaskStatus,
  TaskType,
} from "./types";

type SprintLite = {
  id: string;
  name: string;
  status?: string;
};

/** Stories used by TaskSheet. `__id` (DB id) is required only by the create
 *  flow's user-story picker; pure-view callers may pass plain `Story`s. */
type StoryWithMaybeDbId = Story & { __id?: string };

export type TaskCreateInput = {
  title: string;
  description?: string;
  type: TaskType;
  scope: TaskScope;
  complexity: TaskComplexity;
  area: TaskArea;
  status: TaskStatus;
  /** UserStory id (DB), or null if standalone. */
  userStoryId: string | null;
  functionPoints: number;
};

type TaskSheetProps = {
  task: Task | null;
  stories: StoryWithMaybeDbId[];
  modules: Module[];
  members: Member[];
  definitionOfDone: string[];
  /** @deprecated kept for prop-compat with callers; ignored. The sheet has no
   *  view/edit toggle anymore — every field is always inline-editable. */
  editing?: boolean;
  /** When true, opens in create mode (no `task` required). */
  creating?: boolean;
  /** Default story DB id pre-selected in create mode. */
  defaultStoryId?: string | null;
  onClose: () => void;
  /** @deprecated no-op. */
  onEdit?: () => void;
  /** @deprecated no-op. */
  onCancelEdit?: () => void;
  /** Persist a Task patch (called per-field, with the merged Task). */
  onSave: (updated: Task) => void | Promise<void>;
  /** Required when `creating` is true. */
  onCreate?: (input: TaskCreateInput) => void | Promise<void>;
  /** Open the parent story when breadcrumb is clicked. */
  onOpenStory?: (storyRef: string) => void;
  /** Sprint picker support. When omitted, the row is read-only. */
  sprints?: SprintLite[];
  onChangeSprint?: (taskRef: string, sprintId: string | null) => void | Promise<void>;
  /** Multi-assignee toggle. When omitted, assignees become read-only. */
  onChangeAssignees?: (taskRef: string, memberIds: string[]) => void | Promise<void>;
};

const AREA_VALUES: { value: TaskArea; label: string }[] = [
  { value: "front", label: "Front" },
  { value: "back",  label: "Back"  },
  { value: "infra", label: "Infra" },
  { value: "ops",   label: "Ops"   },
  { value: "mixed", label: "Mixed" },
];

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
  const { task, creating, onClose } = props;
  const isOpen = creating === true || task !== null;
  return (
    <ResponsiveSheet
      open={isOpen}
      onOpenChange={(open) => !open && onClose()}
    >
      <ResponsiveSheetContent size="lg" showCloseButton={false}>
        {creating ? (
          <TaskSheetCreate {...props} />
        ) : task ? (
          <TaskSheetInner {...props} task={task} />
        ) : null}
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

function TaskSheetInner({
  task,
  stories,
  modules,
  members,
  sprints,
  definitionOfDone,
  onClose,
  onSave,
  onOpenStory,
  onChangeSprint,
  onChangeAssignees,
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

  // ─── AC handlers (mutation via onSave with merged AC list) ────────────────
  function patchAC(id: string, text: string) {
    persist({
      acceptanceCriteria: task.acceptanceCriteria.map((ac) =>
        ac.id === id ? { ...ac, text } : ac,
      ),
    });
  }
  function toggleAC(id: string) {
    persist({
      acceptanceCriteria: task.acceptanceCriteria.map((ac) =>
        ac.id === id
          ? {
              ...ac,
              checked: !ac.checked,
              checkedBy: !ac.checked ? "Você" : undefined,
            }
          : ac,
      ),
    });
  }
  function removeAC(id: string) {
    persist({
      acceptanceCriteria: task.acceptanceCriteria.filter((ac) => ac.id !== id),
    });
  }
  function addAC() {
    const newAc: AC = {
      id: `ac-new-${Date.now()}`,
      text: "",
      checked: false,
    };
    persist({
      acceptanceCriteria: [...task.acceptanceCriteria, newAc],
    });
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
            <ResponsiveSheetTitle className="text-[1.4375rem]">
              <Textarea
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                onBlur={() => persistIfChanged("title", title)}
                rows={1}
                className="block w-full resize-none border-0 bg-transparent px-0 py-0 text-[1.4375rem] font-semibold leading-snug shadow-none focus-visible:ring-0 min-h-0 field-sizing-content dark:bg-transparent"
                placeholder="Título da task"
              />
            </ResponsiveSheetTitle>
            <div className="flex flex-wrap items-center gap-2 text-[10px]">
              <Badge variant="outline">{task.scope} · {task.complexity}</Badge>
              <Badge variant="outline" className="font-mono">
                {task.functionPoints} FP
              </Badge>
              {task.createdByAgent ? (
                <span className="ml-auto inline-flex items-center gap-1 uppercase tracking-wider text-muted-foreground">
                  <Sparkles className="size-3" /> Alpha
                </span>
              ) : null}
            </div>
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
        {/* Status + Area */}
        <div className="grid grid-cols-2 gap-3">
          <FieldBlock label="Status">
            <Select
              value={task.status}
              onValueChange={(v) =>
                v !== null && persist({ status: v as TaskStatus })
              }
            >
              <SelectTrigger className="w-full h-9"><SelectValue /></SelectTrigger>
              <SelectContent>
                {(Object.keys(TASK_STATUS_MAP) as TaskStatus[]).map((s) => (
                  <SelectItem key={s} value={s}>
                    {TASK_STATUS_MAP[s].label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </FieldBlock>

          <FieldBlock label="Area">
            <Select
              value={task.area === null ? "__none" : task.area}
              onValueChange={(v) => {
                if (v === null) return;
                persist({
                  area: v === "__none" ? null : (v as TaskArea),
                });
              }}
            >
              <SelectTrigger className="w-full h-9"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__none">— sem area —</SelectItem>
                {AREA_VALUES.map((a) => (
                  <SelectItem key={String(a.value)} value={String(a.value)}>
                    {a.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </FieldBlock>
        </div>

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

        {/* Type / Scope / Complexity / FP */}
        <div className="grid grid-cols-3 gap-3">
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

        {/* Function Points + Assignees */}
        <div
          className={`grid gap-3 items-start ${
            onChangeAssignees ? "grid-cols-2" : "grid-cols-1"
          }`}
        >
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

        <Separator />

        <AcList
          mode="edit"
          items={task.acceptanceCriteria}
          onToggle={toggleAC}
          onChange={patchAC}
          onAdd={addAC}
          onRemove={removeAC}
        />

        <Separator />

        {/* Description + Notes — inline, save on blur */}
        <FieldBlock label="Descrição">
          <Textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            onBlur={() =>
              persistIfChanged(
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
              persistIfChanged(
                "notes",
                notes.trim() === "" ? null : notes,
              )
            }
            placeholder="Snippets, queries, referências, observações técnicas…"
            rows={4}
            className="font-mono text-sm"
          />
        </FieldBlock>

        <TaskActivitySection
          taskId={(task as Task & { __id?: string }).__id ?? null}
        />

        <div className="rounded-md border border-dashed bg-muted/30 p-3">
          <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            Definition of Done · projeto
          </div>
          <ul className="mt-1.5 space-y-0.5 text-[11px] text-muted-foreground">
            {definitionOfDone.map((d, i) => (
              <li key={i}>· {d}</li>
            ))}
          </ul>
        </div>
      </ResponsiveSheetBody>
    </>
  );
}

// ─── Create mode ─────────────────────────────────────────────────────────────

const STORY_NONE = "__none__";

function TaskSheetCreate({
  stories,
  defaultStoryId,
  onClose,
  onCreate,
}: TaskSheetProps) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [type, setType] = useState<TaskType>("feature");
  const [scope, setScope] = useState<TaskScope>("small");
  const [complexity, setComplexity] = useState<TaskComplexity>("medium");
  const [area, setArea] = useState<TaskArea>(null);
  const [status, setStatus] = useState<TaskStatus>("backlog");
  const [storyId, setStoryId] = useState<string>(defaultStoryId ?? STORY_NONE);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    setTitle("");
    setDescription("");
    setType("feature");
    setScope("small");
    setComplexity("medium");
    setArea(null);
    setStatus("backlog");
    setStoryId(defaultStoryId ?? STORY_NONE);
    setSubmitting(false);
  }, [defaultStoryId]);

  const fp = suggestFunctionPoints(scope, complexity);
  const valid = title.trim().length >= 3;

  async function submit() {
    if (!valid || submitting || !onCreate) return;
    setSubmitting(true);
    try {
      await onCreate({
        title: title.trim(),
        description: description.trim() || undefined,
        type,
        scope,
        complexity,
        area,
        status,
        userStoryId: storyId === STORY_NONE ? null : storyId,
        functionPoints: fp,
      });
      onClose();
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <>
      <ResponsiveSheetHeader>
        <ResponsiveSheetTitle>Nova task</ResponsiveSheetTitle>
        <p className="text-sm text-muted-foreground">
          Quebrar uma story em ações executáveis.
        </p>
      </ResponsiveSheetHeader>

      <ResponsiveSheetBody className="space-y-4">
        <FieldBlock label="Título">
          <Input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Implementar endpoint /auth/magic-link"
            autoFocus
          />
        </FieldBlock>

        <FieldBlock label="Descrição">
          <Textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={2}
          />
        </FieldBlock>

        <div className="grid grid-cols-2 gap-3">
          <FieldBlock label="Story">
            <Select
              value={storyId}
              onValueChange={(v) => v !== null && setStoryId(v)}
            >
              <SelectTrigger>
                <SelectValue placeholder="Escolha story">
                  {(v: string | null) => {
                    if (!v || v === STORY_NONE) {
                      return (
                        <span className="text-muted-foreground">
                          Sem story (avulsa)
                        </span>
                      );
                    }
                    const story = stories.find((s) => s.__id === v);
                    if (!story) return "Escolha story";
                    return (
                      <span className="flex items-center gap-1.5">
                        <span className="font-mono text-xs text-muted-foreground">
                          {story.reference}
                        </span>
                        <span className="truncate">· {story.title}</span>
                      </span>
                    );
                  }}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={STORY_NONE}>Sem story (avulsa)</SelectItem>
                {stories
                  .filter((s): s is Story & { __id: string } => !!s.__id)
                  .map((s) => (
                    <SelectItem key={s.__id} value={s.__id}>
                      <span className="font-mono text-xs">{s.reference}</span>{" "}
                      · {s.title}
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
          </FieldBlock>

          <FieldBlock label="Status">
            <Select
              value={status}
              onValueChange={(v) =>
                v !== null && setStatus(v as TaskStatus)
              }
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(
                  [
                    "backlog",
                    "todo",
                    "in_progress",
                    "review",
                    "done",
                  ] as TaskStatus[]
                ).map((s) => (
                  <SelectItem key={s} value={s}>
                    {s}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </FieldBlock>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <FieldBlock label="Tipo">
            <Select
              value={type}
              onValueChange={(v) => v !== null && setType(v as TaskType)}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {TYPE_VALUES.map((t) => (
                  <SelectItem key={t} value={t}>
                    {t}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </FieldBlock>

          <FieldBlock label="Area">
            <Select
              value={area === null ? "__none" : area}
              onValueChange={(v) => {
                if (v === null) return;
                setArea(v === "__none" ? null : (v as TaskArea));
              }}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__none">— sem area —</SelectItem>
                {AREA_VALUES.map((a) => (
                  <SelectItem key={String(a.value)} value={String(a.value)}>
                    {a.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </FieldBlock>
        </div>

        <div className="grid grid-cols-3 gap-3">
          <FieldBlock label="Scope">
            <Select
              value={scope}
              onValueChange={(v) =>
                v !== null && setScope(v as TaskScope)
              }
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {SCOPE_VALUES.map((s) => (
                  <SelectItem key={s} value={s}>
                    {s}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </FieldBlock>

          <FieldBlock label="Complexity">
            <Select
              value={complexity}
              onValueChange={(v) =>
                v !== null && setComplexity(v as TaskComplexity)
              }
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {COMPLEXITY_VALUES.map((c) => (
                  <SelectItem key={c} value={c}>
                    {c}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </FieldBlock>

          <FieldBlock label="FP (auto)">
            <Input
              value={fp}
              readOnly
              className="font-mono tabular-nums"
            />
          </FieldBlock>
        </div>
      </ResponsiveSheetBody>

      <ResponsiveSheetFooter>
        <Button variant="ghost" onClick={onClose}>
          Cancelar
        </Button>
        <Button onClick={submit} disabled={!valid || submitting}>
          {submitting ? "Criando…" : "Criar task"}
        </Button>
      </ResponsiveSheetFooter>
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
