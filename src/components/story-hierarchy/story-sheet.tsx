"use client";

import { useState } from "react";
import { Pencil, Plus, Sparkles, X } from "lucide-react";
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
import {
  ComputedStatusChip,
  REFINEMENT_MAP,
  RefinementChip,
  TaskStatusChip,
} from "./chips";
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

type StorySheetProps = {
  story: Story | null;
  tasks: Task[];
  modules: Module[];
  personas: Persona[];
  definitionOfDone: string[];
  editing: boolean;
  onClose: () => void;
  onEdit: () => void;
  onCancelEdit: () => void;
  onSave: (updated: Story) => void;
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
  const { story, editing, onClose } = props;
  return (
    <Sheet open={story !== null} onOpenChange={(open) => !open && onClose()}>
      <SheetContent
        side="right"
        className="w-full !sm:max-w-[640px] gap-0 p-0"
        showCloseButton={false}
      >
        {story ? (
          editing ? (
            <StorySheetEdit {...props} story={story} />
          ) : (
            <StorySheetView {...props} story={story} />
          )
        ) : null}
      </SheetContent>
    </Sheet>
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
      <SheetHeader className="border-b">
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
            <SheetTitle>{story.title}</SheetTitle>
            <SheetDescription>
              Como{" "}
              <strong className="text-foreground">
                {persona?.name ?? "—"}
              </strong>
              , quero {story.want}
              {story.soThat ? <>, para que {story.soThat}.</> : "."}
            </SheetDescription>
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
                  {task.area ? (
                    <Badge variant="outline" className="text-[10px]">
                      {task.area}
                    </Badge>
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
      </div>
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
      <SheetHeader className="border-b">
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
            <SheetTitle>Editar story</SheetTitle>
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
                <SelectValue />
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
              <SelectValue />
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
          mode="edit"
          items={draft.acceptanceCriteria}
          onToggle={toggleAC}
          onChange={patchAC}
          onAdd={addAC}
          onRemove={removeAC}
        />
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
