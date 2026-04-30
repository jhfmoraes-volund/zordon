"use client";

import { useEffect, useMemo, useState } from "react";
import { ChevronRight, Code, FileText, Pencil, Sparkles, X } from "lucide-react";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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
import { TaskStatusChip, TASK_STATUS_MAP } from "./chips";
import { AcList } from "./ac-list";
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

type TaskSheetProps = {
  task: Task | null;
  stories: Story[];
  modules: Module[];
  members: Member[];
  definitionOfDone: string[];
  editing: boolean;
  onClose: () => void;
  onEdit: () => void;
  onCancelEdit: () => void;
  onSave: (updated: Task) => void;
  /** Open the parent story when breadcrumb is clicked. */
  onOpenStory?: (storyRef: string) => void;
};

export function TaskSheet(props: TaskSheetProps) {
  const { task, editing, onClose } = props;
  return (
    <Sheet open={task !== null} onOpenChange={(open) => !open && onClose()}>
      <SheetContent
        side="right"
        className="w-full !sm:max-w-[640px] gap-0 p-0"
        showCloseButton={false}
      >
        {task ? (
          editing ? (
            <TaskSheetEdit {...props} task={task} />
          ) : (
            <TaskSheetView {...props} task={task} />
          )
        ) : null}
      </SheetContent>
    </Sheet>
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
    <div className="flex items-center gap-1 text-[11px]">
      {mod ? (
        <Badge variant="outline" className="font-mono text-[10px]">
          {mod.name}
        </Badge>
      ) : story ? (
        <Badge
          variant="outline"
          className="border-dashed font-mono text-[10px] text-muted-foreground"
        >
          sem módulo
        </Badge>
      ) : null}

      {story ? (
        <>
          <ChevronRight className="size-3 text-muted-foreground/60" />
          <button
            type="button"
            onClick={() => onOpenStory?.(story.reference)}
            className="inline-flex items-center gap-1 truncate text-muted-foreground hover:text-foreground hover:underline"
          >
            <span className="font-mono">{story.reference}</span>
            <span className="truncate">— {story.title}</span>
          </button>
          <ChevronRight className="size-3 text-muted-foreground/60" />
        </>
      ) : (
        <Badge
          variant="outline"
          className="border-dashed text-[10px] text-muted-foreground"
        >
          sem story
        </Badge>
      )}

      <span className="font-mono text-foreground">{task.reference}</span>
    </div>
  );
}

// ─── View mode ───────────────────────────────────────────────────────────────

function TaskSheetView({
  task,
  stories,
  modules,
  members,
  definitionOfDone,
  onEdit,
  onSave,
  onClose,
  onOpenStory,
}: TaskSheetProps & { task: Task }) {
  const assignees = task.assigneeIds
    .map((id) => members.find((m) => m.id === id))
    .filter((m): m is Member => Boolean(m));

  // Inline-editable description + notes. Local draft, save on blur.
  const [descDraft, setDescDraft] = useState(task.description ?? "");
  const [notesDraft, setNotesDraft] = useState(task.notes ?? "");

  // Reset drafts when task changes (e.g. user opens a different task).
  useEffect(() => {
    setDescDraft(task.description ?? "");
    setNotesDraft(task.notes ?? "");
  }, [task.reference, task.description, task.notes]);

  function persistField<K extends keyof Task>(field: K, value: Task[K]) {
    if (value === task[field]) return;
    onSave({ ...task, [field]: value } as Task);
  }

  return (
    <>
      <SheetHeader className="border-b">
        <div className="flex items-start justify-between gap-2">
          <div className="space-y-2">
            <Breadcrumb
              task={task}
              stories={stories}
              modules={modules}
              onOpenStory={onOpenStory}
            />
            <SheetTitle>{task.title}</SheetTitle>
            <div className="flex flex-wrap items-center gap-2">
              <TaskStatusChip status={task.status} />
              {task.area ? (
                <Badge variant="outline" className="text-[10px]">
                  {task.area}
                </Badge>
              ) : null}
              <Badge variant="outline" className="text-[10px]">
                {task.type}
              </Badge>
              <Badge variant="outline" className="text-[10px]">
                {task.scope} · {task.complexity}
              </Badge>
              <Badge variant="outline" className="font-mono text-[10px]">
                {task.functionPoints} FP
              </Badge>
              {task.createdByAgent ? (
                <span className="ml-auto inline-flex items-center gap-1 text-[10px] uppercase tracking-wider text-muted-foreground">
                  <Sparkles className="size-3" /> Alpha
                </span>
              ) : null}
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            <Button size="sm" variant="outline" onClick={onEdit}>
              <Pencil className="size-3.5" />
              Editar
            </Button>
            <Button
              size="icon-sm"
              variant="ghost"
              onClick={onClose}
              aria-label="Fechar"
            >
              <X />
            </Button>
          </div>
        </div>
      </SheetHeader>

      <div className="flex-1 space-y-5 overflow-y-auto p-6">
        <AcList mode="view" items={task.acceptanceCriteria} />

        <Separator />

        <section className="space-y-2">
          <h4 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            Atribuição
          </h4>
          <dl className="grid grid-cols-2 gap-y-1 text-xs">
            <dt className="text-muted-foreground">Assignees</dt>
            <dd>
              {assignees.length === 0
                ? "—"
                : assignees.map((m) => m.name).join(", ")}
            </dd>
            <dt className="text-muted-foreground">Due date</dt>
            <dd className="font-mono">{task.dueDate ?? "—"}</dd>
            <dt className="text-muted-foreground">Billable</dt>
            <dd>{task.billable ? "Sim" : "Não"}</dd>
          </dl>
        </section>

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

        <Separator />

        {/* Inline-editable Description + Notes (saves on blur) */}
        <section className="space-y-2">
          <h4 className="inline-flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            <FileText className="size-3.5" /> Descrição
          </h4>
          <Textarea
            value={descDraft}
            onChange={(e) => setDescDraft(e.target.value)}
            onBlur={() =>
              persistField(
                "description",
                descDraft.trim() === "" ? null : descDraft,
              )
            }
            placeholder="O que entregar e por quê"
            rows={3}
            className="text-sm"
          />
        </section>

        <section className="space-y-2">
          <h4 className="inline-flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            <Code className="size-3.5" /> Notas
          </h4>
          <Textarea
            value={notesDraft}
            onChange={(e) => setNotesDraft(e.target.value)}
            onBlur={() =>
              persistField(
                "notes",
                notesDraft.trim() === "" ? null : notesDraft,
              )
            }
            placeholder="Snippets, queries, referências, observações técnicas…"
            rows={4}
            className="font-mono text-sm"
          />
        </section>
      </div>
    </>
  );
}

// ─── Edit mode ───────────────────────────────────────────────────────────────

const AREA_VALUES: { value: TaskArea; label: string }[] = [
  { value: "front", label: "Front"  },
  { value: "back",  label: "Back"   },
  { value: "infra", label: "Infra"  },
  { value: "ops",   label: "Ops"    },
  { value: "mixed", label: "Mixed"  },
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

function TaskSheetEdit({
  task,
  stories,
  modules,
  members,
  onCancelEdit,
  onSave,
  onClose,
}: TaskSheetProps & { task: Task }) {
  const [draft, setDraft] = useState<Task>(task);
  /** When user changes scope/complexity, we re-suggest FP unless they manually
   *  overrode it. Track manual override flag. */
  const [fpManuallyEdited, setFpManuallyEdited] = useState(false);

  function patch<K extends keyof Task>(key: K, value: Task[K]) {
    setDraft((d) => ({ ...d, [key]: value }));
  }

  function patchScopeOrComplexity(
    field: "scope" | "complexity",
    value: TaskScope | TaskComplexity,
  ) {
    setDraft((d) => {
      const next = { ...d, [field]: value } as Task;
      if (!fpManuallyEdited) {
        next.functionPoints = suggestFunctionPoints(next.scope, next.complexity);
      }
      return next;
    });
  }

  function toggleAssignee(id: string) {
    setDraft((d) => ({
      ...d,
      assigneeIds: d.assigneeIds.includes(id)
        ? d.assigneeIds.filter((x) => x !== id)
        : [...d.assigneeIds, id],
    }));
  }

  // ─── AC ────────────────────────────────────────────────────────────────
  function patchAC(id: string, text: string) {
    setDraft((d) => ({
      ...d,
      acceptanceCriteria: d.acceptanceCriteria.map((ac) =>
        ac.id === id ? { ...ac, text } : ac,
      ),
    }));
  }
  function toggleAC(id: string) {
    setDraft((d) => ({
      ...d,
      acceptanceCriteria: d.acceptanceCriteria.map((ac) =>
        ac.id === id
          ? {
              ...ac,
              checked: !ac.checked,
              checkedBy: !ac.checked ? "Você" : undefined,
            }
          : ac,
      ),
    }));
  }
  function removeAC(id: string) {
    setDraft((d) => ({
      ...d,
      acceptanceCriteria: d.acceptanceCriteria.filter((ac) => ac.id !== id),
    }));
  }
  function addAC() {
    const newAc: AC = {
      id: `ac-new-${Date.now()}`,
      text: "",
      checked: false,
    };
    setDraft((d) => ({
      ...d,
      acceptanceCriteria: [...d.acceptanceCriteria, newAc],
    }));
  }

  // Stories filtered by current module of selected story (helps move task to
  // another story without showing dozens unrelated). For mock simplicity we
  // show all stories grouped by module.
  const storiesByModule = useMemo(() => {
    return modules.map((m) => ({
      module: m,
      rows: stories.filter((s) => s.moduleId === m.id),
    }));
  }, [stories, modules]);

  return (
    <>
      <SheetHeader className="border-b">
        <div className="flex items-start justify-between gap-2">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <span className="font-mono text-xs text-muted-foreground">
                {draft.reference}
              </span>
              <Badge
                variant="outline"
                className="border-amber-500/40 text-[10px] text-amber-700 dark:text-amber-400"
              >
                Editando
              </Badge>
            </div>
            <SheetTitle>Editar task</SheetTitle>
            <SheetDescription>
              Alterações ficam locais até salvar.
            </SheetDescription>
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
      </SheetHeader>

      <div className="flex-1 space-y-5 overflow-y-auto p-6">
        {/* Title + description */}
        <div className="space-y-1.5">
          <Label htmlFor="task-title">Título</Label>
          <Input
            id="task-title"
            value={draft.title}
            onChange={(e) => patch("title", e.target.value)}
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="task-desc">Descrição</Label>
          <Textarea
            id="task-desc"
            value={draft.description ?? ""}
            onChange={(e) =>
              patch("description", e.target.value === "" ? null : e.target.value)
            }
            rows={3}
          />
        </div>

        {/* Story link */}
        <div className="space-y-1.5">
          <Label>User Story</Label>
          <Select
            value={draft.userStoryRef ?? "__none"}
            onValueChange={(v) =>
              patch("userStoryRef", v === "__none" ? null : v)
            }
          >
            <SelectTrigger>
              <SelectValue placeholder="Sem story" />
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
        </div>

        <Separator />

        {/* Status + Area */}
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label>Status</Label>
            <Select
              value={draft.status}
              onValueChange={(v) => patch("status", v as TaskStatus)}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(Object.keys(TASK_STATUS_MAP) as TaskStatus[]).map((s) => (
                  <SelectItem key={s} value={s}>
                    {TASK_STATUS_MAP[s].label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label>Area</Label>
            <Select
              value={draft.area === null ? "__none" : draft.area}
              onValueChange={(v) =>
                patch("area", v === "__none" ? null : (v as TaskArea))
              }
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__none">— sem area —</SelectItem>
                {AREA_VALUES.map((a) => (
                  <SelectItem
                    key={String(a.value)}
                    value={String(a.value)}
                  >
                    {a.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        {/* Type + Scope + Complexity */}
        <div className="grid grid-cols-3 gap-3">
          <div className="space-y-1.5">
            <Label>Tipo</Label>
            <Select
              value={draft.type}
              onValueChange={(v) => patch("type", v as TaskType)}
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
          </div>

          <div className="space-y-1.5">
            <Label>Scope</Label>
            <Select
              value={draft.scope}
              onValueChange={(v) =>
                patchScopeOrComplexity("scope", v as TaskScope)
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
          </div>

          <div className="space-y-1.5">
            <Label>Complexity</Label>
            <Select
              value={draft.complexity}
              onValueChange={(v) =>
                patchScopeOrComplexity("complexity", v as TaskComplexity)
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
          </div>
        </div>

        {/* FP */}
        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <Label htmlFor="task-fp">Function Points</Label>
            {fpManuallyEdited ? (
              <button
                type="button"
                className="text-[10px] text-primary hover:underline"
                onClick={() => {
                  setFpManuallyEdited(false);
                  patch(
                    "functionPoints",
                    suggestFunctionPoints(draft.scope, draft.complexity),
                  );
                }}
              >
                Voltar pra sugestão da matriz
              </button>
            ) : (
              <span className="text-[10px] text-muted-foreground">
                Sugerido pela matriz {draft.scope} × {draft.complexity}
              </span>
            )}
          </div>
          <Input
            id="task-fp"
            type="number"
            min={1}
            value={draft.functionPoints}
            onChange={(e) => {
              setFpManuallyEdited(true);
              patch("functionPoints", Number(e.target.value) || 1);
            }}
          />
        </div>

        {/* Assignees */}
        <div className="space-y-1.5">
          <Label>Assignees</Label>
          <div className="flex flex-wrap gap-1.5">
            {members.map((m) => {
              const active = draft.assigneeIds.includes(m.id);
              return (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => toggleAssignee(m.id)}
                  className={`inline-flex h-7 items-center rounded-full border px-2.5 text-xs transition-colors ${
                    active
                      ? "border-primary bg-primary/10 text-primary"
                      : "border-border text-muted-foreground hover:border-foreground/40 hover:text-foreground"
                  }`}
                >
                  {m.name}
                </button>
              );
            })}
          </div>
        </div>

        <Separator />

        <AcList
          mode="edit"
          items={draft.acceptanceCriteria}
          onToggle={toggleAC}
          onChange={patchAC}
          onAdd={addAC}
          onRemove={removeAC}
        />

        <div className="space-y-1.5">
          <Label htmlFor="task-notes">Notas</Label>
          <Textarea
            id="task-notes"
            value={draft.notes ?? ""}
            onChange={(e) =>
              patch("notes", e.target.value === "" ? null : e.target.value)
            }
            rows={3}
          />
        </div>
      </div>

      <div className="flex items-center justify-end gap-2 border-t bg-muted/40 p-4">
        <Button variant="ghost" onClick={onCancelEdit}>
          Cancelar
        </Button>
        <Button onClick={() => onSave(draft)}>Salvar</Button>
      </div>
    </>
  );
}
