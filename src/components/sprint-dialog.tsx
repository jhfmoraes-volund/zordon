"use client";

import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";

// ─── Date helpers ────────────────────────────────────────

function nextMonday(d: Date) {
  const day = d.getDay();
  const diff = day === 0 ? 1 : day === 1 ? 0 : 8 - day;
  const mon = new Date(d);
  mon.setDate(mon.getDate() + diff);
  return mon;
}

function fridayOfWeek(mon: Date) {
  const fri = new Date(mon);
  fri.setDate(fri.getDate() + 4);
  return fri;
}

function toDateStr(d: Date) {
  return d.toISOString().split("T")[0];
}

// ─── Public helper ───────────────────────────────────────

export type ExistingSprint = { endDate: string };

export function getNextSprintDefaults(existingSprints: ExistingSprint[]) {
  const sorted = [...existingSprints].sort(
    (a, b) => new Date(b.endDate).getTime() - new Date(a.endDate).getTime()
  );
  const nextNumber = sorted.length + 1;
  const lastSprint = sorted[0];

  let monday: Date;
  if (lastSprint) {
    const afterLast = new Date(lastSprint.endDate);
    afterLast.setDate(afterLast.getDate() + 1);
    monday = nextMonday(afterLast);
  } else {
    monday = nextMonday(new Date());
  }

  return {
    name: `Sprint ${nextNumber}`,
    startDate: toDateStr(monday),
    endDate: toDateStr(fridayOfWeek(monday)),
  };
}

// ─── Component ───────────────────────────────────────────

export type SprintFormData = {
  name: string;
  startDate: string;
  endDate: string;
  status: string;
  projectId?: string;
};

type EditingSprint = {
  id: string;
  name: string;
  startDate: string;
  endDate: string;
  status: string;
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
    name: "", startDate: "", endDate: "", status: "planning", projectId: "",
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
    return getNextSprintDefaults(sprints);
  };

  useEffect(() => {
    if (!open) return;
    if (editing) {
      setForm({
        name: editing.name,
        startDate: editing.startDate.split("T")[0],
        endDate: editing.endDate.split("T")[0],
        status: editing.status,
        projectId: "",
      });
    } else {
      const defaults = getNextSprintDefaults(existingSprints);
      setForm({
        name: defaults.name,
        startDate: defaults.startDate,
        endDate: defaults.endDate,
        status: "planning",
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
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{editing ? "Editar Sprint" : "Novo Sprint"}</DialogTitle>
        </DialogHeader>
        <div className="grid gap-4 py-4">
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
          <div className="grid grid-cols-2 gap-4">
            <div className="grid gap-2">
              <Label>Início</Label>
              <Input type="date" value={form.startDate} onChange={(e) => setForm({ ...form, startDate: e.target.value })} />
            </div>
            <div className="grid gap-2">
              <Label>Fim</Label>
              <Input type="date" value={form.endDate} onChange={(e) => setForm({ ...form, endDate: e.target.value })} />
            </div>
          </div>
          <div className="grid gap-2">
            <Label>Status</Label>
            <Select value={form.status} onValueChange={(v) => v && setForm({ ...form, status: v })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="planning">Planning</SelectItem>
                <SelectItem value="active">Active</SelectItem>
                <SelectItem value="completed">Completed</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button onClick={handleSave} disabled={!canSave}>{saving ? "Salvando..." : "Salvar"}</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
