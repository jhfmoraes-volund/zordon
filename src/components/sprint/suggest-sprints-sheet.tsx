"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import {
  AlertTriangle,
  ChevronDown,
  ChevronRight,
  Sparkles,
  X,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  ConfirmDialog,
  type ConfirmState,
} from "@/components/ui/confirm-dialog";
import { Field, FormBody } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  ResponsiveSheet,
  ResponsiveSheetBody,
  ResponsiveSheetContent,
  ResponsiveSheetFooter,
  ResponsiveSheetHeader,
  ResponsiveSheetTitle,
} from "@/components/ui/responsive-sheet";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
  fetchOrThrow,
  HttpError,
  showErrorToast,
} from "@/lib/optimistic/toast";
import { SPRINT_GOAL_MAX_LENGTH } from "@/components/sprint/types";
import { TagChip, TagChipOverflow } from "@/components/tags/tag-chip";
import type { ChipTone } from "@/lib/status-chips";
import { toast } from "sonner";

// ─── Server response types (matches /api/projects/[id]/suggest-sprints) ──────

type TaskLayer = "DATA" | "API" | "REALTIME" | "UI" | "OPS";

type TaskTagLite = { id: string; name: string; tone: string };
type ModuleLite = { id: string; name: string };

type ApiTaskReason = {
  unblocks: string[];
  unblocksCount: number;
  layerReason: TaskLayer | null;
  acCount: number;
};

type ApiTask = {
  id: string;
  reference: string | null;
  title: string;
  description: string | null;
  layer: TaskLayer | null;
  moduleId: string | null;
  module: ModuleLite | null;
  points: number;
  tags: TaskTagLite[];
  blockedBy: string[];
  reason: ApiTaskReason;
};

type ApiWarning =
  | { type: "LOW_LAYER_DIVERSITY"; sprintIndex: number }
  | {
      type: "OVERCAPACITY";
      sprintIndex: number;
      taskId: string;
      points: number;
    }
  | { type: "NO_UI_TASK"; sprintIndex: number }
  | {
      type: "STORY_SPLIT_ACROSS_SPRINTS";
      sprintIndex: number;
      storyId: string;
    };

type ModuleEnabled = { id: string; name: string; count: number };

type StoryCompleted = {
  id: string;
  title: string;
  reference: string;
  moduleName: string | null;
  uiTaskTitles: string[];
};

type ModuleCompleted = {
  id: string;
  name: string;
  storyTitles: string[];
  uiTaskTitles: string[];
};

type ContinuedStory = {
  id: string;
  title: string;
  reference: string;
  moduleName: string | null;
  fromSprintNames: string[];
};

type ContinuedModule = {
  id: string;
  name: string;
  fromSprintNames: string[];
};

type SprintRationale = {
  dependsOn: Array<{
    ref: string;
    title: string;
    module: string | null;
    fromSprintName: string | null;
  }>;
  enablesCount: number;
  enablesByModule: ModuleEnabled[];
  primaryModules: ModuleEnabled[];
  storiesCompleted: StoryCompleted[];
  modulesCompleted: ModuleCompleted[];
  continuedStories: ContinuedStory[];
  continuedModules: ContinuedModule[];
  layerDistribution: Record<TaskLayer, number>;
  topTags: Array<{ id: string; name: string; tone: string; count: number }>;
  keyHubs: Array<{
    ref: string;
    title: string;
    module: string | null;
    unblocks: number;
  }>;
  summary: "foundation" | "builds-on" | "mixed";
};

type ApiSprint = {
  suggestedName: string;
  suggestedGoal: string;
  capacityPoints: number;
  totalPoints: number;
  rationale: SprintRationale;
  tasks: ApiTask[];
  warnings: ApiWarning[];
};

type ApiLeftover = {
  id: string;
  reference: string | null;
  title: string;
  layer: TaskLayer | null;
  module: ModuleLite | null;
  points: number;
  tags: TaskTagLite[];
  reason: "CAPACITY" | "BLOCKED_BY_BACKLOG";
};

type ApiContext = {
  totalBacklog: number;
  alreadyAllocated: number;
  nextSprintNumber: number;
  capacityPerSprint: number;
  capacityDefault: number;
  capacitySource:
    | "task_function_points_avg"
    | "sprint_member_allocation_avg"
    | "fallback_40";
  mode: "create-new" | "fill-existing";
  targetSprintId: string | null;
  targetSprintName: string | null;
};

type SuggestResponse = {
  sprints: ApiSprint[];
  leftover: ApiLeftover[];
  context: ApiContext;
};

// Espelha o `max(3)` do Zod em /api/projects/[id]/apply-sprint-suggestion.
// Cap aqui na UI pra impedir que "Sugerir mais 1 sprint" empurre o preview
// pra além do limite e o apply estoure 400 com array de issues do Zod
// (que vira "não foi possível salvar." genérico no toast).
const MAX_SPRINTS_PER_APPLY = 3;

// ─── Local preview state ─────────────────────────────────────────────────────

type PreviewSprint = {
  key: string;
  existingSprintId: string | null;
  name: string;
  goal: string;
  capacityPoints: number;
  rationale: SprintRationale;
  tasks: ApiTask[];
  warnings: ApiWarning[];
};

type PreviewState = {
  sprints: PreviewSprint[];
  leftover: ApiLeftover[];
  context: ApiContext;
};

type EmptySprintOption = { id: string; name: string };

type PlannerMode = "create-new" | "fill-existing";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: string;
  backlogHint?: number;
  emptySprints: EmptySprintOption[];
  initialTargetSprintId?: string | null;
  onApplied?: () => void;
};

// ─── Helpers ────────────────────────────────────────────────────────────────

const KNOWN_TONES: ChipTone[] = [
  "blue", "green", "amber", "red", "purple", "cyan",
  "teal", "pink", "slate", "brand", "muted",
];

function asChipTone(tone: string): ChipTone {
  return (KNOWN_TONES as string[]).includes(tone)
    ? (tone as ChipTone)
    : "muted";
}

function makeKey(prefix: string) {
  return `${prefix}-${Math.random().toString(36).slice(2, 8)}`;
}

function toPreviewSprints(
  api: ApiSprint[],
  fillTargetId: string | null,
): PreviewSprint[] {
  return api.map((s, i) => ({
    key: makeKey("sprint"),
    existingSprintId: i === 0 ? fillTargetId : null,
    name: s.suggestedName,
    goal: s.suggestedGoal,
    capacityPoints: s.capacityPoints,
    rationale: s.rationale,
    tasks: s.tasks,
    warnings: s.warnings,
  }));
}

function TagChips({
  tags,
  max = 2,
}: {
  tags: TaskTagLite[];
  max?: number;
}) {
  if (!tags || tags.length === 0) return null;
  const visible = tags.slice(0, max);
  const overflow = tags.length - visible.length;
  return (
    <>
      {visible.map((t) => (
        <TagChip
          key={t.id}
          name={t.name}
          tone={asChipTone(t.tone)}
          variant="solid"
          size="sm"
        />
      ))}
      {overflow > 0 ? (
        <TagChipOverflow count={overflow} variant="solid" size="sm" />
      ) : null}
    </>
  );
}

// Encurta refs como "ZLAR-V2-T-070" → "T-070". Pega o sufixo após o último
// "-T-", "-B-", etc., mantendo a parte tipográfica + número.
function shortRef(ref: string | null): string {
  if (!ref) return "";
  const parts = ref.split("-");
  if (parts.length >= 2) {
    return `${parts[parts.length - 2]}-${parts[parts.length - 1]}`;
  }
  return ref;
}

// Junta uma lista de strings em frase natural: "A", "A e B", "A, B e C".
function joinNatural(items: string[]): string {
  if (items.length === 0) return "";
  if (items.length === 1) return items[0];
  if (items.length === 2) return `${items[0]} e ${items[1]}`;
  return `${items.slice(0, -1).join(", ")} e ${items[items.length - 1]}`;
}

// ─── Component ──────────────────────────────────────────────────────────────

export function SuggestSprintsSheet({
  open,
  onOpenChange,
  projectId,
  backlogHint,
  emptySprints,
  initialTargetSprintId,
  onApplied,
}: Props) {
  const hasEmptyTarget = emptySprints.length > 0;

  const [mode, setMode] = useState<PlannerMode | null>(null);
  const [targetSprintId, setTargetSprintId] = useState<string | null>(null);
  const [n, setN] = useState<1 | 2 | 3>(1);
  const [capacityInput, setCapacityInput] = useState<string>("");
  const [generating, setGenerating] = useState(false);
  const [applying, setApplying] = useState(false);
  const [preview, setPreview] = useState<PreviewState | null>(null);
  const [confirmState, setConfirmState] = useState<ConfirmState | null>(null);
  const [selectedTask, setSelectedTask] = useState<ApiTask | null>(null);
  const [controlsOpen, setControlsOpen] = useState(true);

  useEffect(() => {
    if (!open) return;
    setPreview(null);
    setCapacityInput("");
    setN(1);
    setSelectedTask(null);
    setControlsOpen(true);
    if (initialTargetSprintId) {
      setMode("fill-existing");
      setTargetSprintId(initialTargetSprintId);
    } else {
      setMode(null);
      setTargetSprintId(null);
    }
  }, [open, initialTargetSprintId]);

  const handleOpenChange = useCallback(
    (next: boolean) => {
      if (!next) setSelectedTask(null);
      onOpenChange(next);
    },
    [onOpenChange],
  );

  const callSuggest = useCallback(
    async (params: {
      n: number;
      previewSprintCount: number;
      excludeTaskIds: string[];
      targetSprintId?: string | null;
    }): Promise<SuggestResponse | null> => {
      try {
        const res = await fetchOrThrow(
          `/api/projects/${projectId}/suggest-sprints`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              n: params.n,
              capacityPerSprint: capacityInput
                ? Number(capacityInput)
                : undefined,
              excludeTaskIds: params.excludeTaskIds,
              previewSprintCount: params.previewSprintCount,
              targetSprintId: params.targetSprintId ?? undefined,
            }),
          },
        );
        return (await res.json()) as SuggestResponse;
      } catch (e) {
        showErrorToast(e, { label: "Sugestão falhou" });
        return null;
      }
    },
    [projectId, capacityInput],
  );

  const generate = useCallback(async () => {
    if (!mode) {
      toast.info("Escolha primeiro o que você quer fazer.");
      return;
    }
    if (mode === "fill-existing" && !targetSprintId) {
      toast.info("Escolha uma sprint vazia pra preencher.");
      return;
    }
    setGenerating(true);
    const data = await callSuggest({
      n: mode === "fill-existing" ? 1 : n,
      previewSprintCount: 0,
      excludeTaskIds: [],
      targetSprintId: mode === "fill-existing" ? targetSprintId : null,
    });
    setGenerating(false);
    if (!data) return;
    setPreview({
      sprints: toPreviewSprints(
        data.sprints,
        mode === "fill-existing" ? targetSprintId : null,
      ),
      leftover: data.leftover,
      context: data.context,
    });
    setSelectedTask(null);
    // Após gerar, colapsa os controles pra focar o usuário nas tasks.
    if (data.sprints.length > 0) {
      setControlsOpen(false);
    } else {
      toast.info(
        "Nenhuma task elegível — todas estão bloqueadas ou já alocadas.",
      );
    }
  }, [callSuggest, mode, n, targetSprintId]);

  const suggestOneMore = useCallback(async () => {
    if (!preview) return;
    if (mode === "fill-existing") return;
    if (preview.sprints.length >= MAX_SPRINTS_PER_APPLY) {
      toast.info(
        `Máximo de ${MAX_SPRINTS_PER_APPLY} sprints por aplicação. Aplique essas e gere outra rodada depois.`,
      );
      return;
    }
    const allocatedNow = preview.sprints.flatMap((s) =>
      s.tasks.map((t) => t.id),
    );
    setGenerating(true);
    const data = await callSuggest({
      n: 1,
      previewSprintCount: preview.sprints.length,
      excludeTaskIds: allocatedNow,
    });
    setGenerating(false);
    if (!data) return;
    if (data.sprints.length === 0) {
      toast.info("Sem tasks pra mais 1 sprint — tudo coberto ou bloqueado.");
      return;
    }
    setPreview((prev) =>
      prev
        ? {
            ...prev,
            sprints: [
              ...prev.sprints,
              ...toPreviewSprints(data.sprints, null),
            ],
            leftover: data.leftover,
          }
        : prev,
    );
  }, [callSuggest, preview, mode]);

  const removeTaskFromSprint = useCallback(
    (taskId: string, fromKey: string) => {
      setPreview((prev) => {
        if (!prev) return prev;
        const target = prev.sprints.find((s) => s.key === fromKey);
        const removed = target?.tasks.find((t) => t.id === taskId);
        if (!removed) return prev;
        const sprints = prev.sprints.map((s) =>
          s.key === fromKey
            ? { ...s, tasks: s.tasks.filter((t) => t.id !== taskId) }
            : s,
        );
        return {
          ...prev,
          sprints,
          leftover: [
            ...prev.leftover,
            {
              id: removed.id,
              reference: removed.reference,
              title: removed.title,
              layer: removed.layer,
              module: removed.module,
              points: removed.points,
              tags: removed.tags,
              reason: "CAPACITY",
            },
          ],
        };
      });
      if (selectedTask?.id === taskId) setSelectedTask(null);
    },
    [selectedTask],
  );

  const addTaskToSprint = useCallback(
    (taskId: string, toKey: string) => {
      setPreview((prev) => {
        if (!prev) return prev;
        const idx = prev.leftover.findIndex((t) => t.id === taskId);
        if (idx === -1) return prev;
        const ltask = prev.leftover[idx];
        const taskForSprint: ApiTask = {
          id: ltask.id,
          reference: ltask.reference,
          title: ltask.title,
          description: null,
          layer: ltask.layer,
          moduleId: ltask.module?.id ?? null,
          module: ltask.module,
          points: ltask.points,
          tags: ltask.tags,
          blockedBy: [],
          reason: {
            unblocks: [],
            unblocksCount: 0,
            layerReason: null,
            acCount: 0,
          },
        };
        return {
          ...prev,
          leftover: prev.leftover.filter((_, i) => i !== idx),
          sprints: prev.sprints.map((s) =>
            s.key === toKey ? { ...s, tasks: [...s.tasks, taskForSprint] } : s,
          ),
        };
      });
    },
    [],
  );

  const renameSprint = useCallback((key: string, name: string) => {
    setPreview((prev) =>
      prev
        ? {
            ...prev,
            sprints: prev.sprints.map((s) =>
              s.key === key ? { ...s, name } : s,
            ),
          }
        : prev,
    );
  }, []);

  const setGoal = useCallback((key: string, goal: string) => {
    setPreview((prev) =>
      prev
        ? {
            ...prev,
            sprints: prev.sprints.map((s) =>
              s.key === key
                ? { ...s, goal: goal.slice(0, SPRINT_GOAL_MAX_LENGTH) }
                : s,
            ),
          }
        : prev,
    );
  }, []);

  const totalsBySprint = useMemo(() => {
    if (!preview) return new Map<string, number>();
    return new Map(
      preview.sprints.map((s) => [
        s.key,
        s.tasks.reduce((acc, t) => acc + t.points, 0),
      ]),
    );
  }, [preview]);

  const totalTasksInPreview = useMemo(
    () =>
      preview
        ? preview.sprints.reduce((acc, s) => acc + s.tasks.length, 0)
        : 0,
    [preview],
  );

  const canApply = !!preview && !applying && totalTasksInPreview > 0;
  const canGenerate =
    mode !== null &&
    (mode === "create-new" || !!targetSprintId) &&
    !generating &&
    !applying;

  const doApply = useCallback(async () => {
    if (!preview) return;
    const payload = {
      sprints: preview.sprints
        .filter((s) => s.tasks.length > 0)
        .map((s) =>
          s.existingSprintId
            ? {
                mode: "fill" as const,
                existingSprintId: s.existingSprintId,
                goal: s.goal.trim(),
                taskIds: s.tasks.map((t) => t.id),
              }
            : {
                mode: "create" as const,
                name: s.name.trim() || "Sprint",
                goal: s.goal.trim(),
                taskIds: s.tasks.map((t) => t.id),
              },
        ),
    };
    if (payload.sprints.length === 0) {
      toast.info("Nenhuma sprint com tasks pra aplicar.");
      return;
    }
    setApplying(true);
    try {
      const res = await fetchOrThrow(
        `/api/projects/${projectId}/apply-sprint-suggestion`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        },
      );
      await res.json();
      const created = payload.sprints.filter((s) => s.mode === "create").length;
      const filled = payload.sprints.filter((s) => s.mode === "fill").length;
      const parts: string[] = [];
      if (created > 0)
        parts.push(
          `${created} sprint${created > 1 ? "s" : ""} criada${created > 1 ? "s" : ""}`,
        );
      if (filled > 0)
        parts.push(
          `${filled} sprint${filled > 1 ? "s" : ""} preenchida${filled > 1 ? "s" : ""}`,
        );
      toast.success(parts.join(" · "));
      handleOpenChange(false);
      onApplied?.();
    } catch (e) {
      // Surface a mensagem real do servidor — o classify genérico mostra só
      // "erro de servidor" pra 5xx, o que esconde info útil pra debug
      // (ex.: "rode a migration X.sql").
      if (e instanceof HttpError && e.body) {
        try {
          const parsed = JSON.parse(e.body);
          const msg =
            typeof parsed?.error === "string" ? parsed.error : null;
          if (msg) {
            toast.error(`Aplicar sugestão falhou: ${msg}`, {
              duration: 10_000,
            });
            return;
          }
        } catch {
          // body não-JSON — cai pro padrão.
        }
      }
      showErrorToast(e, { label: "Aplicar sugestão falhou" });
    } finally {
      setApplying(false);
    }
  }, [preview, projectId, handleOpenChange, onApplied]);

  const requestApply = useCallback(() => {
    if (!preview) return;
    const sprintsToApply = preview.sprints.filter((s) => s.tasks.length > 0);
    const fillCount = sprintsToApply.filter((s) => s.existingSprintId).length;
    const createCount = sprintsToApply.length - fillCount;
    const description =
      [
        createCount > 0
          ? `${createCount} sprint${createCount > 1 ? "s" : ""} nova${createCount > 1 ? "s" : ""}`
          : null,
        fillCount > 0
          ? `${fillCount} sprint${fillCount > 1 ? "s" : ""} existente${fillCount > 1 ? "s" : ""}`
          : null,
      ]
        .filter(Boolean)
        .join(" + ") +
      ` · mover ${totalTasksInPreview} task${totalTasksInPreview > 1 ? "s" : ""} do backlog.`;
    setConfirmState({
      title: "Aplicar sugestão",
      description,
      confirmLabel: "Aplicar",
      cancelLabel: "Cancelar",
      onConfirm: doApply,
    });
  }, [preview, totalTasksInPreview, doApply]);

  // ─── Render ─────────────────────────────────────────────────────────────

  return (
    <>
      {/* Painel de detalhe — aside posicionado adjacente ao sheet principal
          (não usa Dialog/Sheet pra evitar trap de foco e duplo backdrop). */}
      {open && selectedTask ? (
        <TaskDetailAside
          task={selectedTask}
          onClose={() => setSelectedTask(null)}
        />
      ) : null}

      <ResponsiveSheet open={open} onOpenChange={handleOpenChange}>
        <ResponsiveSheetContent size="xl" desktopSide="right">
          <ResponsiveSheetHeader>
            <ResponsiveSheetTitle className="flex items-center gap-2">
              <Sparkles className="size-4" />
              Sugerir tasks pras próximas sprints
            </ResponsiveSheetTitle>
            {preview ? (
              <p className="text-xs text-muted-foreground">
                Backlog: {preview.context.totalBacklog} tasks ·{" "}
                {preview.context.alreadyAllocated} já alocadas
                {preview.context.mode === "fill-existing"
                  ? ` · preenchendo ${preview.context.targetSprintName}`
                  : null}
              </p>
            ) : backlogHint != null ? (
              <p className="text-xs text-muted-foreground">
                Backlog do projeto: {backlogHint} tasks
              </p>
            ) : null}
          </ResponsiveSheetHeader>

          <ResponsiveSheetBody>
            {preview && !controlsOpen ? (
              <button
                type="button"
                onClick={() => setControlsOpen(true)}
                className="flex w-full items-center gap-2 rounded-md border bg-muted/20 px-3 py-2 text-left text-sm font-medium hover:bg-muted/30"
              >
                <ChevronRight className="size-4 shrink-0" />
                <span className="flex-1">Ajustar parâmetros da sugestão</span>
                <span className="text-xs text-muted-foreground">
                  {preview.context.mode === "fill-existing"
                    ? `Preenchendo ${preview.context.targetSprintName}`
                    : `${preview.sprints.length} sprint${preview.sprints.length > 1 ? "s" : ""}`}{" "}
                  · {preview.context.capacityPerSprint} FP
                </span>
              </button>
            ) : (
              <Controls
                preview={preview}
                mode={mode}
                setMode={(m) => {
                  setMode(m);
                  if (m === "create-new") setTargetSprintId(null);
                  else if (m === "fill-existing" && hasEmptyTarget)
                    setTargetSprintId(emptySprints[0].id);
                }}
                hasEmptyTarget={hasEmptyTarget}
                emptySprints={emptySprints}
                targetSprintId={targetSprintId}
                setTargetSprintId={setTargetSprintId}
                n={n}
                setN={setN}
                capacityInput={capacityInput}
                setCapacityInput={setCapacityInput}
                canGenerate={canGenerate}
                generating={generating}
                onGenerate={generate}
                collapsible={!!preview}
                onCollapse={() => setControlsOpen(false)}
              />
            )}

            {preview ? (
              <div className="mt-4 space-y-6">
                {preview.sprints.length === 0 ? (
                  <div className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">
                    Nenhuma sprint sugerida — todas as tasks elegíveis estão
                    bloqueadas por dependências fora do backlog.
                  </div>
                ) : (
                  preview.sprints.map((s, idx) => (
                    <SprintBlock
                      key={s.key}
                      sprint={s}
                      sprintIndex={idx}
                      totalPoints={totalsBySprint.get(s.key) ?? 0}
                      onRename={(name) => renameSprint(s.key, name)}
                      onGoal={(goal) => setGoal(s.key, goal)}
                      onRemoveTask={(taskId) =>
                        removeTaskFromSprint(taskId, s.key)
                      }
                      onSelectTask={(task) => setSelectedTask(task)}
                      selectedTaskId={selectedTask?.id ?? null}
                    />
                  ))
                )}

                {mode === "create-new" && preview.sprints.length > 0 ? (
                  <div className="flex items-center gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={suggestOneMore}
                      disabled={
                        generating ||
                        applying ||
                        preview.sprints.length >= MAX_SPRINTS_PER_APPLY
                      }
                    >
                      {generating ? "Gerando…" : "Sugerir mais 1 sprint"}
                    </Button>
                    {preview.sprints.length >= MAX_SPRINTS_PER_APPLY ? (
                      <span className="text-xs text-muted-foreground">
                        Máximo de {MAX_SPRINTS_PER_APPLY} por aplicação. Aplique
                        essas e gere outra rodada depois.
                      </span>
                    ) : null}
                  </div>
                ) : null}

                {preview.leftover.length > 0 ? (
                  <LeftoverList
                    leftover={preview.leftover}
                    sprintsAvailable={preview.sprints}
                    onAddTask={addTaskToSprint}
                  />
                ) : null}
              </div>
            ) : null}
          </ResponsiveSheetBody>

          <ResponsiveSheetFooter>
            <Button
              variant="outline"
              onClick={() => handleOpenChange(false)}
              disabled={applying}
            >
              Cancelar
            </Button>
            <Button onClick={requestApply} disabled={!canApply}>
              {applying ? "Aplicando…" : "Aplicar"}
            </Button>
          </ResponsiveSheetFooter>
        </ResponsiveSheetContent>
      </ResponsiveSheet>

      <ConfirmDialog
        state={confirmState}
        onClose={() => setConfirmState(null)}
      />
    </>
  );
}

// ─── Controls (top form) ───────────────────────────────────────────────────

function Controls({
  preview,
  mode,
  setMode,
  hasEmptyTarget,
  emptySprints,
  targetSprintId,
  setTargetSprintId,
  n,
  setN,
  capacityInput,
  setCapacityInput,
  canGenerate,
  generating,
  onGenerate,
  collapsible = false,
  onCollapse,
}: {
  preview: PreviewState | null;
  mode: PlannerMode | null;
  setMode: (m: PlannerMode) => void;
  hasEmptyTarget: boolean;
  emptySprints: EmptySprintOption[];
  targetSprintId: string | null;
  setTargetSprintId: (id: string | null) => void;
  n: 1 | 2 | 3;
  setN: (n: 1 | 2 | 3) => void;
  capacityInput: string;
  setCapacityInput: (v: string) => void;
  canGenerate: boolean;
  generating: boolean;
  onGenerate: () => void;
  collapsible?: boolean;
  onCollapse?: () => void;
}) {
  const targetName = targetSprintId
    ? emptySprints.find((s) => s.id === targetSprintId)?.name ?? null
    : null;

  const capacityPlaceholder = preview
    ? String(preview.context.capacityDefault)
    : "auto (média do projeto)";

  return (
    <div className="rounded-lg border bg-muted/30 p-4">
      {collapsible ? (
        <div className="mb-3 flex items-center justify-between">
          <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Parâmetros da sugestão
          </span>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={onCollapse}
            className="h-7"
          >
            <ChevronDown className="size-3.5" />
            Recolher
          </Button>
        </div>
      ) : null}
      <div className="grid gap-4 md:grid-cols-2">
        <FormBody density="compact">
          <Field name="planner-mode" required>
            <Field.Label>O que você quer fazer?</Field.Label>
            <Field.Control>
              <Select
                value={mode ?? ""}
                onValueChange={(v) => v && setMode(v as PlannerMode)}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Selecione">
                    {(value: string | null) => {
                      if (value === "create-new")
                        return "Criar nova(s) sprint(s)";
                      if (value === "fill-existing")
                        return "Preencher sprint vazia";
                      return "Selecione";
                    }}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent
                  align="start"
                  alignItemWithTrigger={false}
                  className="w-auto! min-w-[340px]"
                >
                  <SelectItem value="create-new">
                    Criar nova(s) sprint(s) com tasks sugeridas
                  </SelectItem>
                  <SelectItem value="fill-existing" disabled={!hasEmptyTarget}>
                    Preencher uma sprint existente vazia
                    {!hasEmptyTarget ? " (não há disponível)" : ""}
                  </SelectItem>
                </SelectContent>
              </Select>
            </Field.Control>
          </Field>

          {mode === "create-new" ? (
            <Field name="n">
              <Field.Label>Quantas sprints novas?</Field.Label>
              <div className="flex gap-2">
                {([1, 2, 3] as const).map((v) => (
                  <Button
                    key={v}
                    type="button"
                    size="sm"
                    variant={n === v ? "default" : "outline"}
                    onClick={() => setN(v)}
                  >
                    {v}
                  </Button>
                ))}
              </div>
            </Field>
          ) : mode === "fill-existing" ? (
            <Field name="target-sprint" required>
              <Field.Label>Qual sprint vazia?</Field.Label>
              <Field.Control>
                <Select
                  value={targetSprintId ?? ""}
                  onValueChange={(v) => setTargetSprintId(v || null)}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Selecione">
                      {() => targetName ?? "Selecione"}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {emptySprints.map((s) => (
                      <SelectItem key={s.id} value={s.id}>
                        {s.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field.Control>
            </Field>
          ) : null}
        </FormBody>

        <FormBody density="compact">
          {mode ? (
            <Field name="capacity">
              <Field.Label>Capacidade por sprint (FP)</Field.Label>
              <Field.Control>
                <Input
                  type="number"
                  min={1}
                  placeholder={capacityPlaceholder}
                  value={capacityInput}
                  onChange={(e) => setCapacityInput(e.target.value)}
                />
              </Field.Control>
              <Field.Hint>
                {preview
                  ? `Default: ${preview.context.capacityDefault} (${labelForSource(preview.context.capacitySource)}).`
                  : "Default: soma de FP das tasks nas 3 últimas sprints do projeto."}
              </Field.Hint>
            </Field>
          ) : null}
        </FormBody>
      </div>

      {mode ? (
        <div className="mt-4 flex justify-end">
          <Button onClick={onGenerate} disabled={!canGenerate} size="sm">
            {generating
              ? "Gerando…"
              : preview
                ? "Regerar do zero"
                : "Gerar sugestão"}
          </Button>
        </div>
      ) : null}
    </div>
  );
}

function labelForSource(s: ApiContext["capacitySource"]): string {
  switch (s) {
    case "task_function_points_avg":
      return "média de FP das últimas 3 sprints";
    case "sprint_member_allocation_avg":
      return "soma de alocação do time";
    case "fallback_40":
      return "fallback — sem histórico";
  }
}

// ─── Sprint block (rationale ON TOP + card) ─────────────────────────────────

function SprintBlock({
  sprint,
  sprintIndex,
  totalPoints,
  onRename,
  onGoal,
  onRemoveTask,
  onSelectTask,
  selectedTaskId,
}: {
  sprint: PreviewSprint;
  sprintIndex: number;
  totalPoints: number;
  onRename: (name: string) => void;
  onGoal: (goal: string) => void;
  onRemoveTask: (taskId: string) => void;
  onSelectTask: (task: ApiTask) => void;
  selectedTaskId: string | null;
}) {
  return (
    <div className="space-y-2">
      <RationaleExpander
        rationale={sprint.rationale}
        sprintIndex={sprintIndex}
        sprintName={sprint.name}
      />
      <SprintCard
        sprint={sprint}
        sprintIndex={sprintIndex}
        totalPoints={totalPoints}
        onRename={onRename}
        onGoal={onGoal}
        onRemoveTask={onRemoveTask}
        onSelectTask={onSelectTask}
        selectedTaskId={selectedTaskId}
      />
    </div>
  );
}

function SprintCard({
  sprint,
  sprintIndex,
  totalPoints,
  onRename,
  onGoal,
  onRemoveTask,
  onSelectTask,
  selectedTaskId,
}: {
  sprint: PreviewSprint;
  sprintIndex: number;
  totalPoints: number;
  onRename: (name: string) => void;
  onGoal: (goal: string) => void;
  onRemoveTask: (taskId: string) => void;
  onSelectTask: (task: ApiTask) => void;
  selectedTaskId: string | null;
}) {
  const overCapacity = totalPoints > sprint.capacityPoints;

  return (
    <div className="rounded-lg border bg-card shadow-sm">
      <div className="space-y-2 border-b p-3">
        <div className="flex items-start gap-2">
          {sprint.existingSprintId ? (
            <div className="flex flex-1 flex-col gap-0.5">
              <span className="text-xs uppercase tracking-wider text-muted-foreground">
                Preenchendo sprint existente
              </span>
              <span className="font-medium">{sprint.name}</span>
            </div>
          ) : (
            <Input
              value={sprint.name}
              onChange={(e) => onRename(e.target.value)}
              className="h-8 flex-1 font-medium"
            />
          )}
          <Badge variant={overCapacity ? "destructive" : "secondary"}>
            {totalPoints}/{sprint.capacityPoints} FP
          </Badge>
        </div>
        <Textarea
          value={sprint.goal}
          onChange={(e) => onGoal(e.target.value)}
          placeholder="Objetivo da sprint (opcional)"
          rows={2}
          className="min-h-[3rem] resize-none text-sm"
        />
        {sprint.warnings.length > 0 ? (
          <div className="space-y-1">
            {aggregateWarnings(sprint.warnings).map((w, i) => (
              <Warning key={i} warning={w} sprintIndex={sprintIndex} />
            ))}
          </div>
        ) : null}
      </div>

      <ul className="divide-y">
        {sprint.tasks.length === 0 ? (
          <li className="px-3 py-4 text-center text-xs text-muted-foreground">
            (Vazio — remova tasks daqui ou volte tasks do backlog logo abaixo)
          </li>
        ) : (
          sprint.tasks.map((task) => (
            <TaskRow
              key={task.id}
              task={task}
              isSelected={selectedTaskId === task.id}
              onSelect={() => onSelectTask(task)}
              onRemove={() => onRemoveTask(task.id)}
            />
          ))
        )}
      </ul>
    </div>
  );
}

// ─── Por que essa priorização? (collapsible, above the card) ────────────────

function RationaleExpander({
  rationale,
  sprintIndex,
  sprintName,
}: {
  rationale: SprintRationale;
  sprintIndex: number;
  sprintName: string;
}) {
  const [open, setOpen] = useState(false);
  const sentences = useMemo(
    () => buildRationaleSentences(rationale, sprintIndex),
    [rationale, sprintIndex],
  );
  const hasContent = sentences.length > 0;

  if (!hasContent) return null;

  return (
    <div className="rounded-md border bg-muted/20">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm font-medium hover:bg-muted/30"
        aria-expanded={open}
      >
        {open ? (
          <ChevronDown className="size-4 shrink-0" />
        ) : (
          <ChevronRight className="size-4 shrink-0" />
        )}
        <span>
          Por que essa priorização?{" "}
          <span className="text-muted-foreground">— {sprintName}</span>
        </span>
      </button>
      {open ? (
        <div className="space-y-2 border-t px-3 py-3 text-xs leading-relaxed text-foreground/80">
          {sentences.map((s, i) => (
            <p key={i}>{s}</p>
          ))}
          <TagGroups topTags={rationale.topTags} />
        </div>
      ) : null}
    </div>
  );
}

function buildRationaleSentences(
  r: SprintRationale,
  sprintIndex: number,
): string[] {
  const out: string[] = [];

  // 0) Continuidade — stories/módulos iniciados em sprints prévias.
  // Vem PRIMEIRO porque é a informação mais relevante pro PM ("porque a gente
  // está pegando essas tasks? porque continua o que começou semana passada").
  if (r.continuedModules.length > 0 || r.continuedStories.length > 0) {
    // Prefere narrar por módulo quando possível (mais alto-nível); senão por story.
    if (r.continuedModules.length > 0) {
      const items = r.continuedModules.slice(0, 3).map((m) => {
        const from =
          m.fromSprintNames.length > 0
            ? ` (iniciado ${m.fromSprintNames.length === 1 ? "na" : "nas"} ${joinNatural(m.fromSprintNames)})`
            : "";
        return `${m.name}${from}`;
      });
      const more =
        r.continuedModules.length > 3
          ? ` e mais ${r.continuedModules.length - 3} módulo${r.continuedModules.length - 3 > 1 ? "s" : ""}`
          : "";
      out.push(
        `Continua trabalho ${r.continuedModules.length === 1 ? "no módulo" : "nos módulos"} ${joinNatural(items)}${more} — finaliza o que está em andamento antes de abrir frentes novas.`,
      );
    } else {
      const items = r.continuedStories.slice(0, 3).map((s) => {
        const mod = s.moduleName ? ` (${s.moduleName})` : "";
        const from =
          s.fromSprintNames.length > 0
            ? ` ${s.fromSprintNames.length === 1 ? "iniciada na" : "iniciada em"} ${joinNatural(s.fromSprintNames)}`
            : "";
        return `"${truncateTitle(s.title, 50)}"${mod}${from}`;
      });
      const more =
        r.continuedStories.length > 3
          ? ` e mais ${r.continuedStories.length - 3} história${r.continuedStories.length - 3 > 1 ? "s" : ""}`
          : "";
      out.push(
        `Continua ${r.continuedStories.length === 1 ? "a história" : "histórias"} ${joinNatural(items)}${more} — fecha o que estava em andamento.`,
      );
    }
  }

  // 1) Intro — depende de sprints anteriores OU é fundação
  if (r.dependsOn.length > 0) {
    const modulesFrom = uniq(
      r.dependsOn.map((d) => d.module).filter((m): m is string => !!m),
    );
    const sprintsFrom = uniq(
      r.dependsOn
        .map((d) => d.fromSprintName)
        .filter((s): s is string => !!s),
    );
    const fromTxt =
      sprintsFrom.length > 0
        ? ` (do que ${
            sprintsFrom.length === 1
              ? `a ${sprintsFrom[0]} entrega`
              : `as sprints anteriores entregam: ${joinNatural(sprintsFrom)}`
          })`
        : "";
    const moduleTxt =
      modulesFrom.length > 0
        ? ` Especificamente, depende de tarefas em ${
            modulesFrom.length === 1
              ? `${modulesFrom[0]}`
              : `${joinNatural(modulesFrom)}`
          }.`
        : "";
    out.push(
      `Essa sprint avança em cima de ${r.dependsOn.length} tarefa${r.dependsOn.length > 1 ? "s" : ""} que ficam prontas antes${fromTxt}.${moduleTxt}`,
    );
  } else if (sprintIndex === 0 && r.keyHubs.length > 0) {
    out.push(
      "É a fundação do plano: nenhuma tarefa aqui espera por outra do backlog — são as bases que tudo o mais usa.",
    );
  } else if (r.keyHubs.length === 0) {
    out.push(
      "Tarefas independentes — sem efeito direto sobre o que vem depois.",
    );
  }

  // 2) Quais áreas estão sendo tocadas dentro da sprint
  if (r.primaryModules.length > 0) {
    const txt = joinNatural(
      r.primaryModules.map((m) => `${m.name} (${m.count})`),
    );
    out.push(
      `Foco: ${txt}${r.primaryModules.length >= 3 ? " entre outros" : ""}.`,
    );
  }

  // 3) O que fica PRONTO ao final dessa sprint — narrativo, módulos + telas.
  if (r.modulesCompleted.length > 0) {
    for (const mod of r.modulesCompleted) {
      const screensTxt =
        mod.uiTaskTitles.length > 0
          ? ` — entrega ${mod.uiTaskTitles.length === 1 ? "a tela" : "as telas"} ${joinNatural(
              mod.uiTaskTitles
                .slice(0, 4)
                .map((t) => `"${truncateTitle(t, 50)}"`),
            )}${mod.uiTaskTitles.length > 4 ? " entre outras" : ""}`
          : "";
      const storiesTxt =
        mod.storyTitles.length > 0
          ? ` (cobrindo ${mod.storyTitles.length === 1 ? "a história" : `${mod.storyTitles.length} histórias`}: ${joinNatural(
              mod.storyTitles
                .slice(0, 3)
                .map((s) => `"${truncateTitle(s, 60)}"`),
            )}${mod.storyTitles.length > 3 ? " entre outras" : ""})`
          : "";
      out.push(
        `Ao final da sprint, o módulo ${mod.name} fica 100% pronto${screensTxt}${storiesTxt}.`,
      );
    }
  } else if (r.storiesCompleted.length > 0) {
    // Sem módulo inteiro, mas algumas histórias completas.
    const count = r.storiesCompleted.length;
    const titles = r.storiesCompleted
      .slice(0, 3)
      .map((s) => `"${truncateTitle(s.title, 60)}"`);
    const screens = uniq(
      r.storiesCompleted.flatMap((s) => s.uiTaskTitles),
    ).slice(0, 4);
    const screensTxt =
      screens.length > 0
        ? `, entregando ${screens.length === 1 ? "a tela" : "as telas"} ${joinNatural(
            screens.map((t) => `"${truncateTitle(t, 50)}"`),
          )}`
        : "";
    out.push(
      `Ao final da sprint, ${count === 1 ? "a história" : `${count} histórias`} ${joinNatural(titles)}${count > 3 ? " entre outras" : ""} fica${count > 1 ? "m" : ""} 100% pronta${count > 1 ? "s" : ""}${screensTxt}.`,
    );
  }

  // 4) Tarefas-chave — explicadas pela própria descrição (não pelo ref)
  if (r.keyHubs.length > 0) {
    const hubText = r.keyHubs
      .map((h) => {
        const mod = h.module ? ` (${h.module})` : "";
        return `"${truncateTitle(h.title)}"${mod} — destrava ${h.unblocks} tarefa${h.unblocks > 1 ? "s" : ""}`;
      })
      .join("; ");
    out.push(`As tarefas-chave aqui são ${hubText}.`);
  }

  // 5) O que destrava ao terminar — agrupado por módulo
  if (r.enablesCount > 0) {
    if (r.enablesByModule.length > 0) {
      const modText = joinNatural(
        r.enablesByModule.map((m) => `${m.count} em ${m.name}`),
      );
      out.push(
        `Quando essa sprint terminar, libera ${r.enablesCount} tarefa${r.enablesCount > 1 ? "s" : ""} no backlog — principalmente ${modText}.`,
      );
    } else {
      out.push(
        `Quando essa sprint terminar, libera ${r.enablesCount} tarefa${r.enablesCount > 1 ? "s" : ""} do backlog pra serem feitas.`,
      );
    }
  }

  return out;
}

// ─── Tag groups (Tipos + Prioridade), separados ─────────────────────────────

const PRIORITY_TAG_RE = /^p[1-4](\b|\W|$)/i;

function TagGroups({
  topTags,
}: {
  topTags: SprintRationale["topTags"];
}) {
  if (topTags.length === 0) return null;
  const priority = topTags
    .filter((t) => PRIORITY_TAG_RE.test(t.name.trim()))
    .sort((a, b) => a.name.localeCompare(b.name));
  const types = topTags.filter(
    (t) => !PRIORITY_TAG_RE.test(t.name.trim()),
  );

  if (priority.length === 0 && types.length === 0) return null;

  return (
    <div className="space-y-1 pt-1">
      {types.length > 0 ? (
        <p className="flex flex-wrap items-center gap-1.5">
          <span className="text-muted-foreground">Tipos:</span>
          {types.map((t) => (
            <TagChip
              key={t.id}
              name={`${t.name} × ${t.count}`}
              tone={asChipTone(t.tone)}
              variant="solid"
              size="sm"
            />
          ))}
        </p>
      ) : null}
      {priority.length > 0 ? (
        <p className="flex flex-wrap items-center gap-1.5">
          <span className="text-muted-foreground">Prioridade:</span>
          {priority.map((t) => (
            <TagChip
              key={t.id}
              name={`${t.name} × ${t.count}`}
              tone={asChipTone(t.tone)}
              variant="solid"
              size="sm"
            />
          ))}
        </p>
      ) : null}
    </div>
  );
}

function truncateTitle(t: string, max = 80): string {
  return t.length <= max ? t : t.slice(0, max - 1) + "…";
}

function uniq<T>(arr: T[]): T[] {
  return [...new Set(arr)];
}

// ─── Task row ────────────────────────────────────────────────────────────

function TaskRow({
  task,
  isSelected,
  onSelect,
  onRemove,
}: {
  task: ApiTask;
  isSelected: boolean;
  onSelect: () => void;
  onRemove: () => void;
}) {
  const reasonBits: string[] = [];
  if (task.reason.unblocksCount > 0) {
    reasonBits.push(`desbloqueia ${task.reason.unblocksCount}`);
  }
  if (task.reason.acCount > 0) {
    reasonBits.push(`${task.reason.acCount} AC`);
  }

  return (
    <li
      className={`flex items-center gap-2 px-3 py-2 text-sm transition-colors ${isSelected ? "bg-muted/50" : "hover:bg-muted/30"}`}
    >
      <button
        type="button"
        onClick={onSelect}
        className="group flex min-w-0 flex-1 items-center gap-2 text-left"
      >
        <span className="shrink-0 font-mono text-xs text-muted-foreground">
          {shortRef(task.reference) || task.id.slice(0, 6)}
        </span>
        <span
          className="min-w-0 flex-1 truncate group-hover:underline"
          title={task.title}
        >
          {task.title}
        </span>
        {reasonBits.length > 0 ? (
          <span className="hidden shrink-0 text-[10px] text-muted-foreground md:inline">
            {reasonBits.join(" · ")}
          </span>
        ) : null}
      </button>
      <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
        {task.points}fp
      </span>
      <Button
        type="button"
        size="icon"
        variant="ghost"
        className="size-6 shrink-0 text-muted-foreground hover:text-destructive"
        aria-label="Remover task da sprint"
        title="Remover da sprint (volta pro backlog)"
        onClick={onRemove}
      >
        <X className="size-3.5" />
      </Button>
    </li>
  );
}

// ─── Leftover ────────────────────────────────────────────────────────────────

function LeftoverList({
  leftover,
  sprintsAvailable,
  onAddTask,
}: {
  leftover: ApiLeftover[];
  sprintsAvailable: PreviewSprint[];
  onAddTask: (taskId: string, toKey: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const blockedCount = leftover.filter(
    (t) => t.reason === "BLOCKED_BY_BACKLOG",
  ).length;

  return (
    <div className="rounded-lg border border-dashed bg-muted/20">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm font-medium hover:bg-muted/30"
        aria-expanded={open}
      >
        {open ? (
          <ChevronDown className="size-4 shrink-0" />
        ) : (
          <ChevronRight className="size-4 shrink-0" />
        )}
        <span className="flex-1">
          {leftover.length} task{leftover.length > 1 ? "s" : ""} no backlog
        </span>
        {blockedCount > 0 ? (
          <span className="text-[10px] text-amber-700">
            {blockedCount} bloqueada{blockedCount > 1 ? "s" : ""}
          </span>
        ) : null}
      </button>
      {open ? (
        <ul className="max-h-72 divide-y overflow-y-auto border-t">
          {leftover.slice(0, 50).map((task) => (
            <li
              key={task.id}
              className="flex items-center gap-2 px-3 py-2 text-sm"
            >
              <span className="shrink-0 font-mono text-xs text-muted-foreground">
                {shortRef(task.reference) || task.id.slice(0, 6)}
              </span>
              <span className="flex-1 truncate">{task.title}</span>
              <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                {task.points}fp
              </span>
              {task.reason === "BLOCKED_BY_BACKLOG" ? (
                <span className="shrink-0 text-[10px] text-amber-700">
                  bloqueada
                </span>
              ) : null}
              <Select
                value=""
                onValueChange={(v) => v && onAddTask(task.id, v)}
                disabled={sprintsAvailable.length === 0}
              >
                <SelectTrigger className="h-7 w-28 text-xs">
                  <SelectValue placeholder="Adicionar…" />
                </SelectTrigger>
                <SelectContent>
                  {sprintsAvailable.map((s, i) => (
                    <SelectItem key={s.key} value={s.key}>
                      → {s.name || `Sprint ${i + 1}`}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </li>
          ))}
          {leftover.length > 50 ? (
            <li className="px-3 py-2 text-center text-xs text-muted-foreground">
              +{leftover.length - 50} ocultas
            </li>
          ) : null}
        </ul>
      ) : null}
    </div>
  );
}

// ─── Warning row ────────────────────────────────────────────────────────────

/**
 * STORY_SPLIT_ACROSS_SPRINTS sai do planner uma vez por story afetada — se 3
 * stories quebram, vêm 3 warnings idênticos em texto. Dedup pra UI: mantém
 * uma só linha mas anota a contagem.
 */
type AggregatedWarning =
  | ApiWarning
  | { type: "STORY_SPLIT_AGG"; sprintIndex: number; count: number };

function aggregateWarnings(warnings: ApiWarning[]): AggregatedWarning[] {
  const splitCount = warnings.filter(
    (w) => w.type === "STORY_SPLIT_ACROSS_SPRINTS",
  ).length;
  const others = warnings.filter(
    (w) => w.type !== "STORY_SPLIT_ACROSS_SPRINTS",
  );
  if (splitCount === 0) return others;
  return [
    ...others,
    {
      type: "STORY_SPLIT_AGG",
      sprintIndex: warnings[0].sprintIndex,
      count: splitCount,
    },
  ];
}

function Warning({
  warning,
}: {
  warning: AggregatedWarning;
  sprintIndex: number;
}) {
  let msg: string;
  switch (warning.type) {
    case "LOW_LAYER_DIVERSITY":
      msg =
        "Sprint só com 1 categoria de task — considere variar pra não deixar time ocioso.";
      break;
    case "OVERCAPACITY":
      msg = `Task acima da capacidade (${warning.points}fp) — ocupa a sprint sozinha.`;
      break;
    case "NO_UI_TASK":
      msg =
        "Sprint sem saída visual (nenhuma task de UI) — cliente não tem nada demoável ao final.";
      break;
    case "STORY_SPLIT_ACROSS_SPRINTS":
      msg =
        "Story dividida entre sprints — algumas tasks dessa story ficam pra depois.";
      break;
    case "STORY_SPLIT_AGG":
      msg =
        warning.count === 1
          ? "Story dividida entre sprints — algumas tasks dessa story ficam pra depois."
          : `${warning.count} stories divididas entre sprints — partes ficam pra próximas sprints.`;
      break;
  }
  return (
    <div className="flex items-center gap-1.5 text-[11px] text-amber-700">
      <AlertTriangle className="size-3" />
      <span>{msg}</span>
    </div>
  );
}

// ─── Task detail aside (anchored next to the main sheet, not as a Dialog) ──

function TaskDetailAside({
  task,
  onClose,
}: {
  task: ApiTask;
  onClose: () => void;
}) {
  // Mede a posição REAL do sheet principal e ancora o aside na borda esquerda
  // dele. Mais robusto que CSS porque funciona mesmo quando o sheet não está
  // exatamente em 1024px (ex.: viewports onde w-3/4 vence o max-width, ou
  // qualquer outra surpresa de layout).
  const [sheetLeft, setSheetLeft] = useState<number | null>(null);

  useEffect(() => {
    if (typeof window === "undefined") return;
    let observer: ResizeObserver | null = null;
    let rafId = 0;

    const measure = (el: Element) => {
      const rect = el.getBoundingClientRect();
      setSheetLeft(rect.left);
    };

    const tryFind = () => {
      const sheetEl = document.querySelector(
        '[data-slot="sheet-content"][data-side="right"]',
      );
      if (!sheetEl) {
        rafId = requestAnimationFrame(tryFind);
        return;
      }
      measure(sheetEl);
      observer = new ResizeObserver(() => measure(sheetEl));
      observer.observe(sheetEl);
      const onResize = () => measure(sheetEl);
      window.addEventListener("resize", onResize);
      // Guarda o handler pra limpar depois.
      (observer as unknown as { __onResize?: () => void }).__onResize = onResize;
    };

    tryFind();

    return () => {
      cancelAnimationFrame(rafId);
      if (observer) {
        const onResize = (observer as unknown as { __onResize?: () => void })
          .__onResize;
        if (onResize) window.removeEventListener("resize", onResize);
        observer.disconnect();
      }
    };
  }, []);

  if (typeof document === "undefined") return null;
  if (sheetLeft === null || sheetLeft <= 200) {
    // Sem espaço útil pra mostrar o aside (viewport muito estreita).
    return null;
  }

  const MAX_WIDTH = 640;
  const MIN_WIDTH = 320;
  const asideWidth = Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, sheetLeft));
  const asideLeft = Math.max(0, sheetLeft - asideWidth);

  return createPortal(
    <aside
      // Posicionamento computado em JS pra GARANTIR alinhamento com a borda
      // esquerda real do sheet (sem depender de CSS calc/clamp que pode
      // falhar em arbitrary values do Tailwind ou conflitar com containing
      // blocks de ancestrais).
      style={{
        position: "fixed",
        top: 0,
        bottom: 0,
        left: `${asideLeft}px`,
        width: `${asideWidth}px`,
        zIndex: 60,
      }}
      className={[
        "flex flex-col",
        "bg-popover text-popover-foreground shadow-2xl border-l",
        "animate-in fade-in-0 duration-200",
      ].join(" ")}
      role="dialog"
      aria-label="Detalhes da task"
    >
      <header className="flex items-start gap-2 border-b px-4 py-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <TagChips tags={task.tags} max={3} />
            <span className="font-mono text-xs text-muted-foreground">
              {task.reference ?? task.id.slice(0, 8)}
            </span>
            {task.module ? (
              <span className="text-xs text-muted-foreground">
                · {task.module.name}
              </span>
            ) : null}
          </div>
          <h3 className="mt-1 break-words text-sm font-medium leading-tight">
            {task.title}
          </h3>
        </div>
        <Button
          type="button"
          size="icon"
          variant="ghost"
          onClick={onClose}
          aria-label="Fechar detalhes"
          className="size-7 shrink-0"
        >
          <X className="size-4" />
        </Button>
      </header>

      <div className="flex-1 space-y-4 overflow-y-auto px-4 py-3 text-sm">
        <Section label="Detalhes">
          <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5 text-xs">
            <dt className="text-muted-foreground">Pontos</dt>
            <dd className="font-medium tabular-nums">{task.points}</dd>
            <dt className="text-muted-foreground">AC cobertos</dt>
            <dd className="font-medium tabular-nums">{task.reason.acCount}</dd>
            {task.module ? (
              <>
                <dt className="text-muted-foreground">Módulo</dt>
                <dd className="font-medium">{task.module.name}</dd>
              </>
            ) : null}
            {task.tags.length > 0 ? (
              <>
                <dt className="text-muted-foreground">Tags</dt>
                <dd className="flex flex-wrap gap-1">
                  {task.tags.map((t) => (
                    <TagChip
                      key={t.id}
                      name={t.name}
                      tone={asChipTone(t.tone)}
                      variant="solid"
                      size="sm"
                    />
                  ))}
                </dd>
              </>
            ) : null}
          </dl>
        </Section>

        {task.description ? (
          <Section label="Descrição">
            <p className="whitespace-pre-wrap text-xs leading-relaxed text-foreground/80">
              {task.description}
            </p>
          </Section>
        ) : null}

        <Section label="Por que essa task?">
          <ul className="space-y-1 text-xs text-muted-foreground">
            {task.reason.unblocksCount > 0 ? (
              <li>
                <span className="text-foreground/80">
                  Desbloqueia {task.reason.unblocksCount} task
                  {task.reason.unblocksCount > 1 ? "s" : ""}:
                </span>{" "}
                {task.reason.unblocks.map((r, i) => (
                  <span key={r}>
                    <code className="rounded bg-background px-1 py-0.5 text-[10px]">
                      {r}
                    </code>
                    {i < task.reason.unblocks.length - 1 ? ", " : ""}
                  </span>
                ))}
                {task.reason.unblocksCount > task.reason.unblocks.length
                  ? ` +${task.reason.unblocksCount - task.reason.unblocks.length}`
                  : ""}
              </li>
            ) : (
              <li>Sem dependentes diretos — entrou pela ordem padrão.</li>
            )}
            {task.blockedBy.length > 0 ? (
              <li>
                <span className="text-foreground/80">
                  Espera (precisa estar pronto antes):
                </span>{" "}
                {task.blockedBy.map((r, i) => (
                  <span key={r}>
                    <code className="rounded bg-background px-1 py-0.5 text-[10px]">
                      {r}
                    </code>
                    {i < task.blockedBy.length - 1 ? ", " : ""}
                  </span>
                ))}
              </li>
            ) : null}
          </ul>
        </Section>
      </div>
    </aside>,
    document.body,
  );
}

function Section({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <section>
      <h4 className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
        {label}
      </h4>
      {children}
    </section>
  );
}
