"use client";

import { useState, useEffect } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
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
};

export function SprintDialog({
  open, onOpenChange, editing, existingSprints, onSave,
  projects, allSprints,
}: Props) {
  const [form, setForm] = useState<SprintFormData>({
    name: "", startDate: "", endDate: "", status: "upcoming", goal: "", projectId: "",
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
      });
    } else {
      const defaults = getNextSprintDefaults(existingSprints);
      setForm({
        name: defaults.name,
        startDate: defaults.startDate,
        endDate: defaults.endDate,
        status: "upcoming",
        goal: "",
        projectId: "",
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
  const canSave = !saving && (editing ? !!form.name : (hasProjectSelector ? !!form.projectId : true));

  return (
    <ResponsiveDialog open={open} onOpenChange={onOpenChange}>
      <ResponsiveDialogContent>
        <ResponsiveDialogHeader>
          <ResponsiveDialogTitle>{editing ? "Editar Sprint" : "Novo Sprint"}</ResponsiveDialogTitle>
        </ResponsiveDialogHeader>
        <ResponsiveDialogBody className="grid gap-4 py-4">
          {hasProjectSelector && (
            <div className="grid gap-2">
              <Label>Projeto</Label>
              <Select value={form.projectId} onValueChange={handleProjectChange}>
                <SelectTrigger>
                  <SelectValue placeholder="Selecione">
                    {(value: string | null) => projects!.find((p) => p.id === value)?.name ?? "Selecione"}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {projects!.map((p) => (
                    <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
          {!editing && defaults && (!hasProjectSelector || form.projectId) && (
            <p className="text-sm text-muted-foreground">{defaults.name}</p>
          )}
          {editing && (
            <div className="grid gap-2">
              <Label>Nome</Label>
              <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            </div>
          )}
          <div className="grid gap-2">
            <Label>Semana</Label>
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
                  const sprints = hasProjectSelector && form.projectId
                    ? sprintsForProject(form.projectId)
                    : existingSprints;
                  const recomputed = getNextSprintDefaults(sprints, shifted.startDate);
                  setForm({ ...form, ...shifted, name: editing ? form.name : recomputed.name });
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
                  const sprints = hasProjectSelector && form.projectId
                    ? sprintsForProject(form.projectId)
                    : existingSprints;
                  const recomputed = getNextSprintDefaults(sprints, shifted.startDate);
                  setForm({ ...form, ...shifted, name: editing ? form.name : recomputed.name });
                }}
              >
                <ChevronRight className="size-4" />
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              Sprints sempre vão de segunda a domingo (7 dias). Use ← / → pra navegar.
            </p>
          </div>
          <div className="grid gap-2">
            <div className="flex items-baseline justify-between">
              <Label htmlFor="sprint-goal">Objetivo do sprint</Label>
              <span className={`text-xs tabular-nums ${form.goal.length > SPRINT_GOAL_MAX_LENGTH ? "text-destructive" : "text-muted-foreground"}`}>
                {form.goal.length}/{SPRINT_GOAL_MAX_LENGTH}
              </span>
            </div>
            <Textarea
              id="sprint-goal"
              value={form.goal}
              onChange={(e) =>
                setForm({ ...form, goal: e.target.value.slice(0, SPRINT_GOAL_MAX_LENGTH) })
              }
              placeholder="Manifesto da iteração — o que precisa ser entregue pra esse sprint ter valido a pena? (opcional)"
              rows={3}
              className="resize-none"
            />
          </div>
          {editing && form.status === "active" ? (
            <div className="grid gap-2">
              <Label>Status</Label>
              <div className="rounded-md border bg-muted/30 px-3 py-2 text-sm">
                Ativa
              </div>
              <p className="text-xs text-muted-foreground">
                Pra trocar de sprint ativa, ative outra a partir da lista.
              </p>
            </div>
          ) : (
            <div className="grid gap-2">
              <Label>Status</Label>
              <Select
                value={form.status === "active" ? "upcoming" : form.status}
                onValueChange={(v) => v && setForm({ ...form, status: v })}
              >
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="upcoming">A iniciar</SelectItem>
                  <SelectItem value="completed">Concluída</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                Use o botão "Ativar sprint" na lista pra promover esta sprint a ativa.
              </p>
            </div>
          )}
        </ResponsiveDialogBody>
        <ResponsiveDialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button onClick={handleSave} disabled={!canSave}>{saving ? "Salvando..." : "Salvar"}</Button>
        </ResponsiveDialogFooter>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}
