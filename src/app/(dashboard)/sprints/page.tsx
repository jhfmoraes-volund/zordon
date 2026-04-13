"use client";

import { useEffect, useState } from "react";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Pencil, Trash2, KanbanSquare, ChevronDown, ChevronRight,
} from "lucide-react";
import Link from "next/link";

type SprintMember = {
  id: string;
  name: string;
  fpCapacity: number;
  fpAllocated: number;
};

type Sprint = {
  id: string;
  name: string;
  startDate: string;
  endDate: string;
  status: string;
  projectId: string;
  project: { id: string; name: string };
  taskStats: { total: number; done: number; percent: number };
  totalFp: number;
  members: SprintMember[];
};

type Project = { id: string; name: string };

type GroupedSprints = { project: Project; sprints: Sprint[] };

const statusColors: Record<string, string> = {
  planning: "bg-muted text-muted-foreground",
  active: "bg-green-500/20 text-green-400",
  completed: "bg-blue-500/20 text-blue-400",
};

function usageColor(pct: number) {
  if (pct <= 0.5) return "bg-green-500";
  if (pct <= 0.7) return "bg-blue-500";
  if (pct <= 0.85) return "bg-yellow-500";
  return "bg-red-500";
}

export default function SprintsPage() {
  const [sprints, setSprints] = useState<Sprint[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Sprint | null>(null);
  const [expandedProjects, setExpandedProjects] = useState<Set<string>>(new Set());
  const [form, setForm] = useState({
    name: "", startDate: "", endDate: "", status: "planning", projectId: "",
  });

  const load = () => {
    fetch("/api/sprints").then((r) => r.json()).then((data: Sprint[]) => {
      setSprints(data);
      // Auto-expand projects that have active sprints
      const active = new Set(
        data.filter((s) => s.status === "active").map((s) => s.projectId)
      );
      setExpandedProjects(active);
    });
    fetch("/api/projects").then((r) => r.json()).then(setProjects);
  };

  useEffect(() => { load(); }, []);

  const grouped: GroupedSprints[] = (() => {
    const map = new Map<string, GroupedSprints>();
    for (const s of sprints) {
      if (!map.has(s.projectId)) {
        map.set(s.projectId, { project: s.project, sprints: [] });
      }
      map.get(s.projectId)!.sprints.push(s);
    }
    return Array.from(map.values());
  })();

  const toggleProject = (projectId: string) => {
    setExpandedProjects((prev) => {
      const next = new Set(prev);
      if (next.has(projectId)) next.delete(projectId);
      else next.add(projectId);
      return next;
    });
  };

  const openNew = () => {
    setEditing(null);
    const today = new Date().toISOString().split("T")[0];
    const twoWeeks = new Date(Date.now() + 14 * 86400000).toISOString().split("T")[0];
    setForm({ name: "", startDate: today, endDate: twoWeeks, status: "planning", projectId: "" });
    setOpen(true);
  };

  const openEdit = (s: Sprint) => {
    setEditing(s);
    setForm({
      name: s.name,
      startDate: s.startDate.split("T")[0],
      endDate: s.endDate.split("T")[0],
      status: s.status,
      projectId: s.projectId,
    });
    setOpen(true);
  };

  const save = async () => {
    const body = {
      name: form.name,
      startDate: new Date(form.startDate).toISOString(),
      endDate: new Date(form.endDate).toISOString(),
      status: form.status,
      projectId: form.projectId,
    };
    if (editing) {
      await fetch(`/api/sprints/${editing.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
    } else {
      await fetch("/api/sprints", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
    }
    setOpen(false);
    load();
  };

  const remove = async (id: string) => {
    if (!confirm("Remover este sprint?")) return;
    await fetch(`/api/sprints/${id}`, { method: "DELETE" });
    load();
  };

  const fmt = (d: string) => new Date(d).toLocaleDateString("pt-BR", {
    day: "2-digit", month: "short",
  });

  const fmtRange = (start: string, end: string) => `${fmt(start)} — ${fmt(end)}`;

  return (
    <div className="space-y-6">
      <PageHeader title="Sprints" onAdd={openNew} addLabel="Novo Sprint" />

      {grouped.length === 0 && (
        <p className="text-muted-foreground text-center py-8">
          Nenhum sprint cadastrado.
        </p>
      )}

      <div className="space-y-2">
        {grouped.map(({ project, sprints: projectSprints }) => {
          const isExpanded = expandedProjects.has(project.id);
          const activeSprint = projectSprints.find((s) => s.status === "active");

          return (
            <div key={project.id} className="surface">
              {/* Project header */}
              <button
                onClick={() => toggleProject(project.id)}
                className="flex w-full items-center gap-3 px-4 py-3 hover:bg-muted/50 transition-colors"
              >
                {isExpanded
                  ? <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0" />
                  : <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
                }
                <span className="font-semibold text-sm">{project.name}</span>
                <span className="text-xs text-muted-foreground">
                  {projectSprints.length} sprint{projectSprints.length !== 1 ? "s" : ""}
                </span>
                {activeSprint && !isExpanded && (
                  <Badge variant="secondary" className="ml-auto bg-green-500/20 text-green-400 text-xs">
                    {activeSprint.name} — {activeSprint.taskStats.percent}%
                  </Badge>
                )}
              </button>

              {/* Sprint rows */}
              {isExpanded && (
                <div className="border-t">
                  {projectSprints.map((s) => (
                    <div key={s.id} className="border-b last:border-b-0">
                      <div className="flex items-center gap-4 px-4 py-2.5 hover:bg-muted/30 transition-colors">
                        {/* Name + status */}
                        <div className="flex items-center gap-2 min-w-[160px]">
                          <Badge variant="secondary" className={`${statusColors[s.status]} text-xs`}>
                            {s.status}
                          </Badge>
                          <span className="text-sm font-medium">{s.name}</span>
                        </div>

                        {/* Date range */}
                        <span className="text-xs text-muted-foreground whitespace-nowrap">
                          {fmtRange(s.startDate, s.endDate)}
                        </span>

                        {/* FP */}
                        <span className="text-xs font-medium tabular-nums">{s.totalFp} FP</span>

                        {/* Progress bar */}
                        <div className="flex items-center gap-2 flex-1 min-w-[120px]">
                          <div className="h-2 flex-1 rounded-full bg-muted overflow-hidden">
                            <div
                              className={`h-full rounded-full transition-all ${
                                s.taskStats.percent === 100
                                  ? "bg-green-500"
                                  : s.taskStats.percent > 0
                                    ? "bg-primary"
                                    : "bg-muted"
                              }`}
                              style={{ width: `${s.taskStats.percent}%` }}
                            />
                          </div>
                          <span className="text-xs font-medium tabular-nums w-[52px] text-right">
                            {s.taskStats.done}/{s.taskStats.total}
                          </span>
                        </div>

                        {/* Actions */}
                        <div className="flex items-center gap-1 shrink-0">
                          <Link href={`/sprints/${s.id}/board`}>
                            <Button variant="outline" size="sm" className="h-7 text-xs">
                              <KanbanSquare className="mr-1 h-3.5 w-3.5" />
                              Board
                            </Button>
                          </Link>
                          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => openEdit(s)}>
                            <Pencil className="h-3 w-3" />
                          </Button>
                          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => remove(s.id)}>
                            <Trash2 className="h-3 w-3" />
                          </Button>
                        </div>
                      </div>

                      {/* Capacity per member */}
                      {s.members.length > 0 && (
                        <div className="px-4 pb-3 pt-0">
                          <div className="rounded-lg bg-muted/20 p-3 space-y-2">
                            <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">
                              Capacity
                            </p>
                            {s.members.map((m) => {
                              const pct = m.fpCapacity > 0 ? m.fpAllocated / m.fpCapacity : 0;
                              return (
                                <div key={m.id} className="flex items-center gap-2">
                                  <span className="text-xs w-28 truncate">{m.name}</span>
                                  <div className="h-1.5 flex-1 rounded-full bg-secondary overflow-hidden">
                                    <div
                                      className={`h-full rounded-full ${usageColor(pct)}`}
                                      style={{ width: `${Math.min(pct * 100, 100)}%` }}
                                    />
                                  </div>
                                  <span className="text-[10px] tabular-nums text-muted-foreground w-14 text-right">
                                    {m.fpAllocated}/{m.fpCapacity}
                                  </span>
                                  <span className="text-[10px] tabular-nums font-medium w-8 text-right">
                                    {Math.round(pct * 100)}%
                                  </span>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editing ? "Editar Sprint" : "Novo Sprint"}</DialogTitle>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label>Projeto</Label>
              <Select value={form.projectId} onValueChange={(v) => v && setForm({ ...form, projectId: v })}>
                <SelectTrigger>
                  <SelectValue placeholder="Selecione">
                    {(value: string | null) => projects.find((p) => p.id === value)?.name ?? "Selecione"}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {projects.map((p) => (
                    <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-2">
              <Label>Nome</Label>
              <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Sprint 1" />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="grid gap-2">
                <Label>Inicio</Label>
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
            <Button variant="outline" onClick={() => setOpen(false)}>Cancelar</Button>
            <Button onClick={save} disabled={!form.name || !form.projectId}>Salvar</Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
