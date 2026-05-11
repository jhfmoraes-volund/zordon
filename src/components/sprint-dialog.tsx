"use client";

import { useState, useEffect } from "react";
import { ChevronLeft, ChevronRight, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field, FormBody } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { SPRINT_GOAL_MAX_LENGTH } from "@/components/sprint/types";
import {
  ResponsiveDialog,
  ResponsiveDialogContent,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
  ResponsiveDialogFooter,
  ResponsiveDialogBody,
} from "@/components/ui/responsive-dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  getNextSprintDefaults,
  shiftSprintByWeeks,
  type ExistingSprint,
} from "@/lib/sprint-dates";

export { getNextSprintDefaults, type ExistingSprint };

function formatRange(startDate: string, endDate: string) {
  const start = new Date(`${startDate}T00:00:00`);
  const end = new Date(`${endDate}T00:00:00`);
  const fmt = new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "short" });
  return `${fmt.format(start)} → ${fmt.format(end)}`;
}

// ─── Component ───────────────────────────────────────────

export type SprintFormData = {
  name: string;
  startDate: string;
  endDate: string;
  status: string;
  goal: string;
  projectId?: string;
  /** Quando true, após criar a sprint o parent abre o SuggestSprintsSheet
   *  apontando pra ela. Só faz sentido em criação (não edição) e em contexto
   *  de projeto único. Quando null/undefined, usuário ainda não escolheu. */
  autoFillFromBacklog?: boolean | null;
};

type EditingSprint = {
  id: string;
  name: string;
  startDate: string;
  endDate: string;
  status: string;
  goal?: string | null;
};

type ProjectOption = { id: string; name: string };

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  editing: EditingSprint | null;
  existingSprints: ExistingSprint[];
  onSave: (data: SprintFormData) => void | Promise<void>;
  /** When provided, shows a project selector (used in global sprints page).
   *  When omitted, assumes project is already known (project detail page). */
  projects?: ProjectOption[];
  /** All sprints across projects — needed when projects prop is provided
   *  so we can filter by selected project. Each item needs projectId + endDate. */
  allSprints?: (ExistingSprint & { projectId: string })[];
  /** Habilita o select "Preencher com tasks do backlog" abaixo do status.
   *  Só faz sentido fora do contexto multi-projeto. */
  allowAutoFill?: boolean;
};

export function SprintDialog({
  open, onOpenChange, editing, existingSprints, onSave,
  projects, allSprints, allowAutoFill,
}: Props) {
  const [form, setForm] = useState<SprintFormData>({
    name: "", startDate: "", endDate: "", status: "", goal: "", projectId: "",
    autoFillFromBacklog: null,
  });
  const [saving, setSaving] = useState(false);

  const hasProjectSelector = !!projects;

  const sprintsForProject = (projectId: string) => {
    if (allSprints) return allSprints.filter((s) => s.projectId === projectId);
    return existingSprints;
  };

  const currentDefaults = () => {
    const sprints = hasProjectSelector && form.projectId
      ? sprintsForProject(form.projectId)
      : existingSprints;
    return getNextSprintDefaults(sprints, form.startDate || undefined);
  };

  useEffect(() => {
    if (!open) return;
    if (editing) {
      setForm({
        name: editing.name,
        startDate: editing.startDate.split("T")[0],
        endDate: editing.endDate.split("T")[0],
        status: editing.status,
        goal: editing.goal ?? "",
        projectId: "",
        autoFillFromBacklog: null,
      });
    } else {
      const defaults = getNextSprintDefaults(existingSprints);
      setForm({
        name: defaults.name,
        startDate: defaults.startDate,
        endDate: defaults.endDate,
        status: "",
        goal: "",
        projectId: "",
        autoFillFromBacklog: null,
      });
    }
  }, [open, editing]);

  const handleProjectChange = (projectId: string | null) => {
    if (!projectId) return;
    const defaults = getNextSprintDefaults(sprintsForProject(projectId));
    setForm({
      ...form,
      projectId,
      name: defaults.name,
      startDate: defaults.startDate,
      endDate: defaults.endDate,
    });
  };

  const handleSave = async () => {
    if (saving) return;
    setSaving(true);
    try {
      await onSave(form);
    } finally {
      setSaving(false);
    }
  };

  const defaults = editing ? null : currentDefaults();
  const showAutoFill = allowAutoFill && !editing && !hasProjectSelector;
  const needsStatus = !(editing && form.status === "active");
  const statusOk = !needsStatus || !!form.status;
  const autoFillOk = !showAutoFill || form.autoFillFromBacklog !== null;
  const canSave =
    !saving &&
    (editing ? !!form.name : hasProjectSelector ? !!form.projectId : true) &&
    statusOk &&
    autoFillOk;

  return (
    <ResponsiveDialog open={open} onOpenChange={onOpenChange}>
      <ResponsiveDialogContent>
        <ResponsiveDialogHeader>
          <ResponsiveDialogTitle>{editing ? "Editar Sprint" : "Novo Sprint"}</ResponsiveDialogTitle>
        </ResponsiveDialogHeader>
        <ResponsiveDialogBody className="py-4">
          <FormBody>
            {hasProjectSelector && (
              <Field name="sprint-project" required>
                <Field.Label>Projeto</Field.Label>
                <Field.Control>
                  <Select
                    value={form.projectId}
                    onValueChange={handleProjectChange}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Selecione">
                        {(value: string | null) =>
                          projects!.find((p) => p.id === value)?.name ??
                          "Selecione"
                        }
                      </SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      {projects!.map((p) => (
                        <SelectItem key={p.id} value={p.id}>
                          {p.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field.Control>
              </Field>
            )}
            {!editing && defaults && (!hasProjectSelector || form.projectId) && (
              <p className="text-sm text-muted-foreground">{defaults.name}</p>
            )}
            {editing && (
              <Field name="sprint-name" required>
                <Field.Label>Nome</Field.Label>
                <Field.Control>
                  <Input
                    value={form.name}
                    onChange={(e) => setForm({ ...form, name: e.target.value })}
                  />
                </Field.Control>
              </Field>
            )}

            <Field name="sprint-week">
              <Field.Label>Semana</Field.Label>
              <div className="flex items-center gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  aria-label="Semana anterior"
                  disabled={!form.startDate}
                  onClick={() => {
                    if (!form.startDate) return;
                    const shifted = shiftSprintByWeeks(form.startDate, -1);
                    const sprints =
                      hasProjectSelector && form.projectId
                        ? sprintsForProject(form.projectId)
                        : existingSprints;
                    const recomputed = getNextSprintDefaults(
                      sprints,
                      shifted.startDate,
                    );
                    setForm({
                      ...form,
                      ...shifted,
                      name: editing ? form.name : recomputed.name,
                    });
                  }}
                >
                  <ChevronLeft className="size-4" />
                </Button>
                <div className="flex-1 rounded-md border bg-muted/30 px-3 py-2 text-center font-mono text-sm tabular-nums">
                  {form.startDate
                    ? formatRange(form.startDate, form.endDate)
                    : "—"}
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  aria-label="Próxima semana"
                  disabled={!form.startDate}
                  onClick={() => {
                    if (!form.startDate) return;
                    const shifted = shiftSprintByWeeks(form.startDate, 1);
                    const sprints =
                      hasProjectSelector && form.projectId
                        ? sprintsForProject(form.projectId)
                        : existingSprints;
                    const recomputed = getNextSprintDefaults(
                      sprints,
                      shifted.startDate,
                    );
                    setForm({
                      ...form,
                      ...shifted,
                      name: editing ? form.name : recomputed.name,
                    });
                  }}
                >
                  <ChevronRight className="size-4" />
                </Button>
              </div>
              <Field.Hint>
                Sprints sempre vão de segunda a domingo (7 dias). Use ← / → pra
                navegar.
              </Field.Hint>
            </Field>

            <Field name="sprint-goal">
              <Field.Label
                addonAlign="end"
                addon={
                  <span
                    className={`text-xs tabular-nums ${
                      form.goal.length > SPRINT_GOAL_MAX_LENGTH
                        ? "text-destructive"
                        : "text-muted-foreground"
                    }`}
                  >
                    {form.goal.length}/{SPRINT_GOAL_MAX_LENGTH}
                  </span>
                }
              >
                Objetivo do sprint
              </Field.Label>
              <Field.Control>
                <Textarea
                  value={form.goal}
                  onChange={(e) =>
                    setForm({
                      ...form,
                      goal: e.target.value.slice(0, SPRINT_GOAL_MAX_LENGTH),
                    })
                  }
                  placeholder="Manifesto da iteração — o que precisa ser entregue pra esse sprint ter valido a pena? (opcional)"
                  rows={3}
                  className="min-h-24 resize-none"
                />
              </Field.Control>
            </Field>

            {editing && form.status === "active" ? (
              <Field name="sprint-status">
                <Field.Label>Status</Field.Label>
                <div className="rounded-md border bg-muted/30 px-3 py-2 text-sm">
                  Ativa
                </div>
                <Field.Hint>
                  Pra trocar de sprint ativa, ative outra a partir da lista.
                </Field.Hint>
              </Field>
            ) : (
              <Field name="sprint-status" required>
                <Field.Label>Status</Field.Label>
                <Field.Control>
                  <Select
                    value={form.status === "" ? null : form.status}
                    onValueChange={(v) => v && setForm({ ...form, status: v })}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Selecionar">
                        {(v: string | null) => {
                          if (!v) {
                            return (
                              <span className="text-muted-foreground">
                                Selecionar
                              </span>
                            );
                          }
                          return v === "upcoming"
                            ? "A iniciar"
                            : v === "completed"
                              ? "Concluída"
                              : v;
                        }}
                      </SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="upcoming">A iniciar</SelectItem>
                      <SelectItem value="completed">Concluída</SelectItem>
                    </SelectContent>
                  </Select>
                </Field.Control>
                <Field.Hint>
                  Use o botão &quot;Ativar sprint&quot; na lista pra promover
                  esta sprint a ativa.
                </Field.Hint>
              </Field>
            )}

            {showAutoFill ? (
              <Field name="sprint-autofill" required>
                <Field.Label>
                  <span className="inline-flex items-center gap-1.5">
                    <Sparkles className="size-3.5" />
                    Conteúdo da sprint
                  </span>
                </Field.Label>
                <Field.Control>
                  <Select
                    value={
                      form.autoFillFromBacklog === null
                        ? null
                        : form.autoFillFromBacklog
                          ? "auto"
                          : "empty"
                    }
                    onValueChange={(v) =>
                      v &&
                      setForm({
                        ...form,
                        autoFillFromBacklog: v === "auto",
                      })
                    }
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Selecionar">
                        {(v: string | null) => {
                          if (!v) {
                            return (
                              <span className="text-muted-foreground">
                                Selecionar
                              </span>
                            );
                          }
                          return (
                            <span className="block truncate">
                              {v === "auto"
                                ? "Preencher com tasks do backlog"
                                : "Criar vazia"}
                            </span>
                          );
                        }}
                      </SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="empty">
                        Criar vazia (eu adiciono as tasks depois)
                      </SelectItem>
                      <SelectItem value="auto">
                        Preencher com tasks do backlog (sugestão automática)
                      </SelectItem>
                    </SelectContent>
                  </Select>
                </Field.Control>
                <Field.Hint>
                  Em &quot;automático&quot;, ao salvar você revê e ajusta as
                  tasks sugeridas antes de confirmar.
                </Field.Hint>
              </Field>
            ) : null}
          </FormBody>
        </ResponsiveDialogBody>
        <ResponsiveDialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button onClick={handleSave} disabled={!canSave}>{saving ? "Salvando..." : "Salvar"}</Button>
        </ResponsiveDialogFooter>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}
