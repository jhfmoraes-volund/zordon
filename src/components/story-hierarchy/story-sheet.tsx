"use client";

import { useEffect, useState } from "react";
import { Pencil, Plus, Sparkles, X } from "lucide-react";
import {
  ResponsiveSheet,
  ResponsiveSheetBody,
  ResponsiveSheetContent,
  ResponsiveSheetDescription,
  ResponsiveSheetFooter,
  ResponsiveSheetHeader,
  ResponsiveSheetTitle,
} from "@/components/ui/responsive-sheet";
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
  AC,
  Module,
  Persona,
  RefinementStatus,
  Story,
  Task,
} from "./types";

export type StoryCreateInput = {
  title: string;
  want: string;
  soThat?: string;
  personaId: string | null;
  moduleId: string | null;
  proposedModuleName?: string | null;
};

type StorySheetProps = {
  story: Story | null;
  tasks: Task[];
  modules: Module[];
  personas: Persona[];
  definitionOfDone: string[];
  editing: boolean;
  /** When true, opens in create mode (no `story` required). */
  creating?: boolean;
  onClose: () => void;
  onEdit: () => void;
  onCancelEdit: () => void;
  onSave: (updated: Story) => void;
  /** Required when `creating` is true. */
  onCreate?: (input: StoryCreateInput) => void | Promise<void>;
  /** Optional callbacks for inline create flows from the edit form. */
  onCreateModuleRequested?: (suggestedName?: string) => void;
  onCreatePersonaRequested?: () => void;
  /** Approve `proposedModuleName` → creates module + assigns to story. */
  onApproveProposedModule?: (story: Story) => void;
  /** Validate AC (sets acValidatedAt/By). */
  onValidateAc?: (story: Story) => void;
  /** Open task detail when a task row in the sheet is clicked. */
  onOpenTask?: (taskRef: string) => void;
};

export function StorySheet(props: StorySheetProps) {
  const { story, editing, creating, onClose } = props;
  const isOpen = creating === true || story !== null;
  return (
    <ResponsiveSheet
      open={isOpen}
      onOpenChange={(open) => !open && onClose()}
    >
      <ResponsiveSheetContent size="md" showCloseButton={false}>
        {creating ? (
          <StorySheetCreate {...props} />
        ) : story ? (
          editing ? (
            <StorySheetEdit {...props} story={story} />
          ) : (
            <StorySheetView {...props} story={story} />
          )
        ) : null}
      </ResponsiveSheetContent>
    </ResponsiveSheet>
  );
}

// ─── View mode ───────────────────────────────────────────────────────────────

function StorySheetView({
  story,
  tasks,
  modules,
  personas,
  definitionOfDone,
  onEdit,
  onClose,
  onApproveProposedModule,
  onValidateAc,
  onOpenTask,
}: StorySheetProps & { story: Story }) {
  const mod = modules.find((m) => m.id === story.moduleId);
  const persona = personas.find((p) => p.id === story.personaId);
  const status = computeStatus(story, tasks);
  const fps = fpOfStory(story, tasks);
  const counts = taskCountsOfStory(story, tasks);
  const own = tasksOfStory(story, tasks);

  return (
    <>
      <ResponsiveSheetHeader>
        <div className="flex items-start justify-between gap-2">
          <div className="space-y-1">
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
            <ResponsiveSheetTitle>{story.title}</ResponsiveSheetTitle>
            <ResponsiveSheetDescription>
              Como{" "}
              <strong className="text-foreground">
                {persona?.name ?? "—"}
              </strong>
              , quero {story.want}
              {story.soThat ? <>, para que {story.soThat}.</> : "."}
            </ResponsiveSheetDescription>
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
      </ResponsiveSheetHeader>

      <ResponsiveSheetBody className="space-y-5">
        {/* Proposed module banner ──────────────────────────────────── */}
        {story.proposedModuleName && onApproveProposedModule ? (
          <div className="flex items-center justify-between rounded-md border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-xs">
            <span className="text-amber-700 dark:text-amber-400">
              Alpha sugeriu o módulo{" "}
              <span className="font-mono">{story.proposedModuleName}</span>.
            </span>
            <Button
              size="sm"
              variant="outline"
              onClick={() => onApproveProposedModule(story)}
            >
              Aprovar e criar módulo
            </Button>
          </div>
        ) : null}

        <AcList mode="view" items={story.acceptanceCriteria} />

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
                {fps.done} / {fps.total} FP
              </span>
            </div>
          </div>

          {own.length === 0 ? (
            <div className="rounded-md border border-dashed p-3 text-center text-xs text-muted-foreground">
              Nenhuma task ainda. Story precisa ser quebrada antes de entrar
              em sprint.
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
                    {task.functionPoints} FP
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

// ─── Edit mode ───────────────────────────────────────────────────────────────

function StorySheetEdit({
  story,
  modules,
  personas,
  onCancelEdit,
  onSave,
  onClose,
  onCreateModuleRequested,
  onCreatePersonaRequested,
}: StorySheetProps & { story: Story }) {
  const [draft, setDraft] = useState<Story>(story);

  function patch<K extends keyof Story>(key: K, value: Story[K]) {
    setDraft((d) => ({ ...d, [key]: value }));
  }

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

  return (
    <>
      <ResponsiveSheetHeader>
        <div className="flex items-start justify-between gap-2">
          <div className="space-y-1">
            <div className="flex flex-wrap items-center gap-2">
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
            <ResponsiveSheetTitle>Editar story</ResponsiveSheetTitle>
            <ResponsiveSheetDescription>
              Alterações ficam locais até salvar.
            </ResponsiveSheetDescription>
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
        <div className="space-y-1.5">
          <Label htmlFor="story-title">Título</Label>
          <Input
            id="story-title"
            value={draft.title}
            onChange={(e) => patch("title", e.target.value)}
          />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <Label>Módulo</Label>
              {onCreateModuleRequested ? (
                <button
                  type="button"
                  className="text-[10px] text-primary hover:underline"
                  onClick={() =>
                    onCreateModuleRequested(draft.proposedModuleName)
                  }
                >
                  + criar módulo
                </button>
              ) : null}
            </div>
            <Select
              value={draft.moduleId ?? "__none"}
              onValueChange={(v) =>
                patch("moduleId", v === "__none" ? null : v)
              }
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
                    const mod = modules.find((m) => m.id === v);
                    return mod ? (
                      <span className="font-mono">{mod.name}</span>
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
            {draft.moduleId === null && draft.proposedModuleName ? (
              <p className="text-[11px] text-amber-700 dark:text-amber-400">
                Alpha sugeriu:{" "}
                <span className="font-mono">{draft.proposedModuleName}</span>
              </p>
            ) : null}
          </div>

          <div className="space-y-1.5">
            <Label>Refinement</Label>
            <Select
              value={draft.refinementStatus}
              onValueChange={(v) =>
                patch("refinementStatus", v as RefinementStatus)
              }
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(["draft", "refined", "committed"] as RefinementStatus[]).map(
                  (s) => (
                    <SelectItem key={s} value={s}>
                      {REFINEMENT_MAP[s].label}
                    </SelectItem>
                  ),
                )}
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <Label>Persona</Label>
            {onCreatePersonaRequested ? (
              <button
                type="button"
                className="text-[10px] text-primary hover:underline"
                onClick={onCreatePersonaRequested}
              >
                + nova persona
              </button>
            ) : null}
          </div>
          <Select
            value={draft.personaId}
            onValueChange={(v) => v && patch("personaId", v)}
          >
            <SelectTrigger>
              <SelectValue>
                {(v: string | null) =>
                  v
                    ? personas.find((p) => p.id === v)?.name ?? "—"
                    : "—"
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
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="story-want">Quero (want)</Label>
          <Textarea
            id="story-want"
            value={draft.want}
            onChange={(e) => patch("want", e.target.value)}
            rows={2}
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="story-sothat">Para que (soThat) — opcional</Label>
          <Textarea
            id="story-sothat"
            value={draft.soThat ?? ""}
            onChange={(e) =>
              patch("soThat", e.target.value.length === 0 ? null : e.target.value)
            }
            rows={2}
          />
        </div>

        <Separator />

        <AcList
          mode="editDraft"
          items={draft.acceptanceCriteria}
          onToggle={toggleAC}
          onChange={patchAC}
          onAdd={addAC}
          onRemove={removeAC}
        />
      </ResponsiveSheetBody>

      <ResponsiveSheetFooter>
        <Button variant="ghost" onClick={onCancelEdit}>
          Cancelar
        </Button>
        <Button onClick={() => onSave(draft)}>Salvar</Button>
      </ResponsiveSheetFooter>
    </>
  );
}

// ─── Create mode ─────────────────────────────────────────────────────────────

const MODULE_NEW = "__new__";
const MODULE_NONE = "__none__";

function StorySheetCreate({
  modules,
  personas,
  onClose,
  onCreate,
}: StorySheetProps) {
  const [title, setTitle] = useState("");
  const [want, setWant] = useState("");
  const [soThat, setSoThat] = useState("");
  const [personaId, setPersonaId] = useState<string>("");
  const [moduleId, setModuleId] = useState<string>(MODULE_NONE);
  const [proposedModuleName, setProposedModuleName] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    setTitle("");
    setWant("");
    setSoThat("");
    setPersonaId(personas[0]?.id ?? "");
    setModuleId(MODULE_NONE);
    setProposedModuleName("");
    setSubmitting(false);
  }, [personas]);

  function setMod(v: string) {
    setModuleId(v);
    if (v !== MODULE_NEW) setProposedModuleName("");
  }

  const valid =
    title.trim().length >= 3 &&
    want.trim().length >= 3 &&
    !!personaId &&
    (moduleId !== MODULE_NEW ||
      /^[A-Z][A-Z0-9_]*$/.test(proposedModuleName.trim()));

  async function submit() {
    if (!valid || submitting || !onCreate) return;
    setSubmitting(true);
    try {
      await onCreate({
        title: title.trim(),
        want: want.trim(),
        soThat: soThat.trim() || undefined,
        personaId,
        moduleId:
          moduleId === MODULE_NEW || moduleId === MODULE_NONE
            ? null
            : moduleId,
        proposedModuleName:
          moduleId === MODULE_NEW ? proposedModuleName.trim() : null,
      });
      onClose();
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <>
      <ResponsiveSheetHeader>
        <ResponsiveSheetTitle>Nova user story</ResponsiveSheetTitle>
        <ResponsiveSheetDescription>
          Como persona, quero algo, para que tenha valor de negócio.
        </ResponsiveSheetDescription>
      </ResponsiveSheetHeader>

      <ResponsiveSheetBody className="space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="story-create-title">Título</Label>
          <Input
            id="story-create-title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Magic-link com expiração curta"
            autoFocus
          />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label>Persona</Label>
            <Select
              value={personaId}
              onValueChange={(v) => v !== null && setPersonaId(v)}
            >
              <SelectTrigger>
                <SelectValue placeholder="Escolha persona">
                  {(v: string | null) =>
                    v
                      ? personas.find((p) => p.id === v)?.name ??
                        "Escolha persona"
                      : "Escolha persona"
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
          </div>

          <div className="space-y-1.5">
            <Label>Módulo</Label>
            <Select
              value={moduleId}
              onValueChange={(v) => v !== null && setMod(v)}
            >
              <SelectTrigger>
                <SelectValue placeholder="Escolha módulo">
                  {(v: string | null) => {
                    if (!v || v === MODULE_NONE) return "Sem módulo";
                    if (v === MODULE_NEW) return "+ Propor novo";
                    return (
                      modules.find((m) => m.id === v)?.name ?? "Escolha módulo"
                    );
                  }}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={MODULE_NONE}>Sem módulo</SelectItem>
                {modules.map((m) => (
                  <SelectItem key={m.id} value={m.id}>
                    {m.name}
                  </SelectItem>
                ))}
                <SelectItem value={MODULE_NEW}>+ Propor novo</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        {moduleId === MODULE_NEW ? (
          <div className="space-y-1.5">
            <Label htmlFor="story-create-proposed-module">
              Nome proposto (UPPERCASE_SNAKE)
            </Label>
            <Input
              id="story-create-proposed-module"
              value={proposedModuleName}
              onChange={(e) =>
                setProposedModuleName(
                  e.target.value
                    .toUpperCase()
                    .replace(/\s+/g, "_")
                    .replace(/[^A-Z0-9_]/g, ""),
                )
              }
              placeholder="AUDIT_LOG"
            />
            <p className="text-[11px] text-muted-foreground">
              PM precisa aprovar pra virar módulo de fato.
            </p>
          </div>
        ) : null}

        <div className="space-y-1.5">
          <Label htmlFor="story-create-want">Quero…</Label>
          <Textarea
            id="story-create-want"
            value={want}
            onChange={(e) => setWant(e.target.value)}
            placeholder="receber link de login que expira em 10 min"
            rows={2}
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="story-create-so-that">…para que (opcional)</Label>
          <Textarea
            id="story-create-so-that"
            value={soThat}
            onChange={(e) => setSoThat(e.target.value)}
            placeholder="reduzir risco de link vazado"
            rows={2}
          />
        </div>
      </ResponsiveSheetBody>

      <ResponsiveSheetFooter>
        <Button variant="ghost" onClick={onClose}>
          Cancelar
        </Button>
        <Button onClick={submit} disabled={!valid || submitting}>
          {submitting ? "Criando…" : "Criar story"}
        </Button>
      </ResponsiveSheetFooter>
    </>
  );
}
