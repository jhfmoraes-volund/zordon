"use client";

import { useState } from "react";
import { useFieldDebounce } from "@/hooks/use-field-debounce";
import { Plus, Sparkles, Trash2, X } from "lucide-react";
import { ConfirmDialog, type ConfirmState } from "@/components/ui/confirm-dialog";
import {
  ResponsiveSheet,
  ResponsiveSheetBody,
  ResponsiveSheetContent,
  ResponsiveSheetHeader,
  ResponsiveSheetTitle,
} from "@/components/ui/responsive-sheet";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field, FormBody } from "@/components/ui/field";
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  ComputedStatusChip,
  REFINEMENT_MAP,
  RefinementChip,
  TaskStatusChip,
} from "./chips";
import { TagChip, TagChipOverflow } from "@/components/tags/tag-chip";
import type { ChipTone } from "@/lib/status-chips";
import { AcList } from "./ac-list";
import {
  computeStatus,
  fpOfStory,
  tasksOfStory,
  taskCountsOfStory,
} from "./helpers";
import type {
  Module,
  Persona,
  RefinementStatus,
  Story,
  Task,
} from "./types";

type StorySheetProps = {
  story: Story | null;
  tasks: Task[];
  modules: Module[];
  personas: Persona[];
  definitionOfDone: string[];
  onClose: () => void;
  /** Persist a partial Story patch (called per-field from inline edits). */
  onPatch: (patch: Partial<Story>) => void | Promise<void>;
  /** Optional callbacks for inline create flows from the form. */
  onCreateModuleRequested?: (suggestedName?: string) => void;
  onCreatePersonaRequested?: () => void;
  /** Approve `proposedModuleName` → creates module + assigns to story. */
  onApproveProposedModule?: (story: Story) => void;
  /** Validate AC (sets acValidatedAt/By). */
  onValidateAc?: (story: Story) => void;
  /** Open task detail when a task row in the sheet is clicked. */
  onOpenTask?: (taskRef: string) => void;
  /** Create a new task linked to this story. The parent should create the
   *  task with `userStoryRef = story.reference` and open it. */
  onCreateTaskForStory?: (storyRef: string) => void | Promise<void>;
  /** AC handlers — granular like the TaskSheet. When omitted, AC is read-only. */
  onAcCreate?: (storyRef: string, text: string, order: number) => void | Promise<void>;
  onAcUpdateText?: (storyRef: string, acId: string, text: string) => void | Promise<void>;
  onAcToggle?: (storyRef: string, acId: string, checked: boolean) => void | Promise<void>;
  onAcDelete?: (storyRef: string, acId: string) => void | Promise<void>;
  /** Soft delete (dismiss) — only shown when the story was created by Alpha.
   *  Hides the row from the briefing tree but preserves AC, tasks and history. */
  onDelete?: () => void | Promise<void>;
};

export function StorySheet(props: StorySheetProps) {
  const { story, onClose } = props;
  return (
    <ResponsiveSheet
      open={story !== null}
      onOpenChange={(open) => !open && onClose()}
    >
      <ResponsiveSheetContent size="lg" showCloseButton={false}>
        {story ? (
          <StorySheetInner key={story.reference} {...props} story={story} />
        ) : null}
      </ResponsiveSheetContent>
    </ResponsiveSheet>
  );
}

// ─── Inner: always-editable story body ───────────────────────────────────────

function StorySheetInner({
  story,
  tasks,
  modules,
  personas,
  onClose,
  onPatch,
  onCreateModuleRequested,
  onCreatePersonaRequested,
  onApproveProposedModule,
  onValidateAc,
  onOpenTask,
  onCreateTaskForStory,
  onAcCreate,
  onAcUpdateText,
  onAcToggle,
  onAcDelete,
  onDelete,
}: StorySheetProps & { story: Story }) {
  const [confirm, setConfirm] = useState<ConfirmState | null>(null);
  // Local drafts for free-text fields; persist on blur.
  // The outer wrapper keys this component on `story.reference`, so each new
  // story remounts with fresh drafts — no useEffect reconciliation needed.
  const [title, setTitle] = useState(story.title);
  const [want, setWant] = useState(story.want);
  const [soThat, setSoThat] = useState(story.soThat ?? "");

  const { schedule: scheduleTextPersist } = useFieldDebounce(2_000);
  function persistIfChanged<K extends keyof Story>(field: K, value: Story[K]) {
    if (value === story[field]) return;
    onPatch({ [field]: value } as Partial<Story>);
  }
  function persistTextDebounced<K extends keyof Story>(field: K, value: Story[K]) {
    scheduleTextPersist(String(field), () => persistIfChanged(field, value));
  }

  const mod = modules.find((m) => m.id === story.moduleId);
  const persona = personas.find((p) => p.id === story.personaId);
  const status = computeStatus(story, tasks);
  const fps = fpOfStory(story, tasks);
  const counts = taskCountsOfStory(story, tasks);
  const own = tasksOfStory(story, tasks);

  // ─── AC handlers ─────────────────────────────────────────────────────────
  async function handleAcTextCommit(id: string, text: string) {
    if (!onAcUpdateText) return;
    await onAcUpdateText(story.reference, id, text);
  }
  async function handleAcToggleLocal(id: string, checked: boolean) {
    if (!onAcToggle) return;
    await onAcToggle(story.reference, id, checked);
  }
  async function handleAcRemove(id: string) {
    if (!onAcDelete) return;
    await onAcDelete(story.reference, id);
  }
  async function handleAcAdd() {
    if (!onAcCreate) return;
    await onAcCreate(story.reference, "", story.acceptanceCriteria.length);
  }

  return (
    <>
      <ResponsiveSheetHeader>
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0 flex-1 space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-mono text-xs text-muted-foreground">
                {story.reference}
              </span>
              {mod ? (
                <Badge variant="outline" className="font-mono text-[10px]">
                  {mod.name}
                </Badge>
              ) : story.proposedModuleName ? (
                <Badge
                  variant="outline"
                  className="border-amber-500/40 font-mono text-[10px] text-amber-700 dark:text-amber-400"
                >
                  proposed: {story.proposedModuleName}
                </Badge>
              ) : (
                <Badge
                  variant="outline"
                  className="border-dashed text-[10px] text-muted-foreground"
                >
                  sem módulo
                </Badge>
              )}
              <RefinementChip status={story.refinementStatus} />
              <ComputedStatusChip status={status} />
              {story.createdByAgent ? (
                <span className="ml-auto inline-flex items-center gap-1 text-[10px] uppercase tracking-wider text-muted-foreground">
                  <Sparkles className="size-3" /> Alpha
                </span>
              ) : null}
            </div>
            <ResponsiveSheetTitle className="sr-only">
              {title || "Título da story"}
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
              placeholder="Título da story"
            />
          </div>
          <div className="flex items-center gap-1">
            {onDelete && story.createdByAgent ? (
              <Button
                size="icon-sm"
                variant="ghost"
                aria-label="Descartar story"
                title="Descartar story (gerada por Alpha)"
                onClick={() =>
                  setConfirm({
                    title: "Descartar story?",
                    description:
                      "Esta indicação do Vitor some do briefing. Tasks e AC vinculados também ficam arquivados.",
                    confirmLabel: "Descartar",
                    destructive: true,
                    onConfirm: () => onDelete(),
                  })
                }
                className="text-muted-foreground hover:text-destructive"
              >
                <Trash2 />
              </Button>
            ) : null}
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
      </ResponsiveSheetHeader>

      <ResponsiveSheetBody className="space-y-5">
        {/* Proposed module banner ──────────────────────────────────── */}
        {story.proposedModuleName && onApproveProposedModule ? (
          <div className="flex items-center justify-between gap-3 rounded-md border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-xs">
            <span className="text-amber-700 dark:text-amber-400">
              Alpha sugeriu o módulo{" "}
              <span className="font-mono">{story.proposedModuleName}</span>.
            </span>
            <div className="flex shrink-0 items-center gap-1.5">
              <Button
                size="sm"
                variant="ghost"
                onClick={() =>
                  // Story.proposedModuleName é `string | undefined` no tipo da
                  // UI; o adapter normaliza `null` do DB → `undefined`. Já o
                  // backend aceita explicitamente `null` pra limpar — daí o
                  // cast via unknown.
                  onPatch({
                    proposedModuleName: null,
                  } as unknown as Partial<Story>)
                }
              >
                Descartar
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => onApproveProposedModule(story)}
              >
                Aprovar e criar módulo
              </Button>
            </div>
          </div>
        ) : null}

        <FormBody>
          <Field name="story-want" required>
            <Field.Label>Quero (want)</Field.Label>
            <Field.Control>
              <Textarea
                value={want}
                onChange={(e) => setWant(e.target.value)}
                onBlur={() => persistTextDebounced("want", want)}
                rows={2}
              />
            </Field.Control>
          </Field>

          <Field name="story-sothat">
            <Field.Label>Para que (soThat) — opcional</Field.Label>
            <Field.Control>
              <Textarea
                value={soThat}
                onChange={(e) => setSoThat(e.target.value)}
                onBlur={() =>
                  persistTextDebounced(
                    "soThat",
                    soThat.trim() === "" ? null : soThat,
                  )
                }
                rows={2}
              />
            </Field.Control>
          </Field>

          <Separator />

          <Field.Row cols={2}>
            <Field name="story-module">
              <Field.Label
                addon={
                  onCreateModuleRequested ? (
                    <button
                      type="button"
                      aria-label="Criar módulo"
                      title="Criar módulo"
                      className="inline-flex size-4 items-center justify-center rounded-[4px] bg-primary text-primary-foreground transition-colors hover:bg-primary/90"
                      onClick={() =>
                        onCreateModuleRequested(story.proposedModuleName)
                      }
                    >
                      <Plus className="size-3" strokeWidth={2.5} />
                    </button>
                  ) : undefined
                }
              >
                Módulo
              </Field.Label>
              <Field.Control>
                <Select
                  value={story.moduleId ?? "__none"}
                  onValueChange={(v) => {
                    if (v === null) return;
                    onPatch({ moduleId: v === "__none" ? null : v });
                  }}
                >
                  <SelectTrigger>
                    <SelectValue>
                      {(v: string | null) => {
                        if (!v || v === "__none") {
                          return (
                            <span className="text-muted-foreground">
                              — sem módulo —
                            </span>
                          );
                        }
                        const m = modules.find((x) => x.id === v);
                        return m ? (
                          <span className="font-mono">{m.name}</span>
                        ) : (
                          <span className="text-muted-foreground">
                            — sem módulo —
                          </span>
                        );
                      }}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none">— sem módulo —</SelectItem>
                    {modules.map((m) => (
                      <SelectItem key={m.id} value={m.id}>
                        <span className="font-mono">{m.name}</span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field.Control>
              {story.moduleId === null && story.proposedModuleName ? (
                <Field.Hint tone="warning">
                  Alpha sugeriu:{" "}
                  <span className="font-mono">{story.proposedModuleName}</span>
                </Field.Hint>
              ) : null}
            </Field>

            <Field name="story-refinement">
              <Field.Label>Refinement</Field.Label>
              <Field.Control>
                <Select
                  value={story.refinementStatus}
                  onValueChange={(v) => {
                    if (v === null) return;
                    onPatch({ refinementStatus: v as RefinementStatus });
                  }}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {(["draft", "committed"] as RefinementStatus[]).map((s) => (
                      <SelectItem key={s} value={s}>
                        {REFINEMENT_MAP[s].label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field.Control>
            </Field>
          </Field.Row>

          <Field name="story-persona">
            <Field.Label
              addon={
                onCreatePersonaRequested ? (
                  <button
                    type="button"
                    aria-label="Nova persona"
                    title="Nova persona"
                    className="inline-flex size-4 items-center justify-center rounded-[4px] bg-primary text-primary-foreground transition-colors hover:bg-primary/90"
                    onClick={onCreatePersonaRequested}
                  >
                    <Plus className="size-3" strokeWidth={2.5} />
                  </button>
                ) : undefined
              }
            >
              Persona
            </Field.Label>
            <Field.Control>
              <Select
                value={story.personaId}
                onValueChange={(v) => {
                  if (!v) return;
                  onPatch({ personaId: v });
                }}
              >
                <SelectTrigger>
                  <SelectValue>
                    {(v: string | null) =>
                      v ? personas.find((p) => p.id === v)?.name ?? "—" : "—"
                    }
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {personas.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field.Control>
          </Field>

          <Separator />

          {/* AC ─────────────────────────────────────────────────────────── */}
          {onAcCreate && onAcUpdateText && onAcToggle && onAcDelete ? (
            <AcList
              mode="editPersisted"
              items={story.acceptanceCriteria}
              onToggle={handleAcToggleLocal}
              onTextCommit={handleAcTextCommit}
              onAdd={handleAcAdd}
              onRemove={handleAcRemove}
            />
          ) : (
            <AcList mode="view" items={story.acceptanceCriteria} />
          )}

          {status === "tasks_complete" && story.acValidatedAt === null ? (
            <div className="flex items-center justify-between rounded-md border border-purple-500/30 bg-purple-500/5 px-3 py-2 text-xs">
              <span className="text-purple-700 dark:text-purple-300">
                Tasks completas. PM valida AC pra fechar.
              </span>
              {onValidateAc ? (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => onValidateAc(story)}
                >
                  Validar AC
                </Button>
              ) : null}
            </div>
          ) : null}

          {story.acValidatedAt ? (
            <div className="rounded-md border border-green-500/30 bg-green-500/5 px-3 py-2 text-[11px] text-green-700 dark:text-green-300">
              AC validado por <strong>{story.acValidatedBy}</strong> em{" "}
              <time className="font-mono tabular-nums">
                {story.acValidatedAt}
              </time>
            </div>
          ) : null}

          <Separator />

          {/* Tasks ────────────────────────────────────────────────────── */}
          <section className="space-y-2">
            <div className="flex items-center justify-between">
              <h4 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                Tasks
              </h4>
              <div className="flex items-center gap-3 text-[11px]">
                <span className="font-mono tabular-nums text-muted-foreground">
                  {counts.done} / {counts.total} tasks
                </span>
                <span className="font-mono tabular-nums">
                  {fps.done} / {fps.total} PFV
                </span>
                {onCreateTaskForStory ? (
                  <Button
                    size="icon-sm"
                    variant="ghost"
                    aria-label="Adicionar task"
                    title="Adicionar task"
                    onClick={() => void onCreateTaskForStory(story.reference)}
                  >
                    <Plus />
                  </Button>
                ) : null}
              </div>
            </div>

            {own.length === 0 ? (
              <div className="flex flex-col items-center gap-2 rounded-md border border-dashed p-4 text-center text-xs text-muted-foreground">
                <span>
                  Nenhuma task ainda. Story precisa ser quebrada antes de entrar
                  em sprint.
                </span>
                {onCreateTaskForStory ? (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => void onCreateTaskForStory(story.reference)}
                  >
                    <Plus className="size-3.5" />
                    Adicionar task
                  </Button>
                ) : null}
              </div>
            ) : (
              <div className="overflow-hidden rounded-md border">
                {own.map((task, i) => (
                  <button
                    key={task.reference}
                    type="button"
                    onClick={() => onOpenTask?.(task.reference)}
                    className={`flex w-full items-center gap-3 px-3 py-2 text-left text-xs transition-colors hover:bg-muted/40 ${
                      i > 0 ? "border-t" : ""
                    }`}
                  >
                    <span className="font-mono text-muted-foreground">
                      {task.reference}
                    </span>
                    {task.tags.length > 0 ? (
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
                    ) : null}
                    <span className="flex-1 truncate">{task.title}</span>
                    <span className="font-mono tabular-nums text-muted-foreground">
                      {task.functionPoints} PFV
                    </span>
                    <TaskStatusChip status={task.status} />
                  </button>
                ))}
              </div>
            )}

            {fps.total > 0 ? (
              <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                <div
                  className="h-full bg-primary"
                  style={{
                    width: `${(fps.done / Math.max(1, fps.total)) * 100}%`,
                  }}
                />
              </div>
            ) : null}
          </section>

          <Separator />

          <section className="space-y-2">
            <h4 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              Origem & metadados
            </h4>
            <dl className="grid grid-cols-2 gap-y-1 text-xs">
              <dt className="text-muted-foreground">Origem</dt>
              <dd className="font-mono">{story.designSessionRef ?? "—"}</dd>
              <dt className="text-muted-foreground">Criada por</dt>
              <dd>{story.createdByAgent ? "Alpha (agente)" : "Manual"}</dd>
              <dt className="text-muted-foreground">Persona</dt>
              <dd>{persona?.name ?? "—"}</dd>
            </dl>
          </section>
        </FormBody>
      </ResponsiveSheetBody>
      <ConfirmDialog state={confirm} onClose={() => setConfirm(null)} />
    </>
  );
}
