"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { SprintDialog, type SprintFormData } from "@/components/sprint-dialog";
import { StatusChip } from "@/components/ui/status-chip";
import { SPRINT_STATUS, lookupChip } from "@/lib/status-chips";
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

  const load = async () => {
    const supabase = createClient();

    const [sprintsRes, projectsRes] = await Promise.all([
      supabase
        .from("Sprint")
        .select("*, project:Project(id, name), tasks:Task(status, functionPoints, assignments:TaskAssignment(member:Member(id, name, fpCapacity)))")
        .order("startDate", { ascending: false }),
      supabase.from("Project").select("id, name").order("name"),
    ]);

    if (sprintsRes.data) {
      const data: Sprint[] = sprintsRes.data.map((s: any) => {
        const tasks: any[] = s.tasks ?? [];
        const total = tasks.length;
        const done = tasks.filter((t: any) => t.status === "done").length;
        const percent = total > 0 ? Math.round((done / total) * 100) : 0;
        const totalFp = tasks.reduce((sum: number, t: any) => sum + (t.functionPoints || 0), 0);

        const memberMap = new Map<string, SprintMember>();
        for (const t of tasks) {
          for (const a of t.assignments ?? []) {
            const m = a.member;
            if (!m) continue;
            if (!memberMap.has(m.id)) {
              memberMap.set(m.id, { id: m.id, name: m.name, fpCapacity: m.fpCapacity || 0, fpAllocated: 0 });
            }
            memberMap.get(m.id)!.fpAllocated += t.functionPoints || 0;
          }
        }

        return {
          id: s.id,
          name: s.name,
          startDate: s.startDate,
          endDate: s.endDate,
          status: s.status,
          projectId: s.projectId,
          project: s.project ?? { id: s.projectId, name: "" },
          taskStats: { total, done, percent },
          totalFp,
          members: Array.from(memberMap.values()),
        };
      });

      setSprints(data);
      const active = new Set(
        data.filter((s) => s.status === "active").map((s) => s.projectId)
      );
      setExpandedProjects(active);
    }

    if (projectsRes.data) setProjects(projectsRes.data);
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

  const handleSave = async (data: SprintFormData) => {
    const supabase = createClient();
    const body = {
      name: data.name,
      startDate: new Date(data.startDate).toISOString(),
      endDate: new Date(data.endDate).toISOString(),
      status: data.status,
      projectId: editing ? editing.projectId : data.projectId!,
    };
    const { error } = editing
      ? await supabase.from("Sprint").update(body).eq("id", editing.id)
      : await supabase.from("Sprint").insert({ id: crypto.randomUUID(), updatedAt: new Date().toISOString(), ...body });
    if (error) {
      if (error.code === "23505") {
        alert("Já existe um sprint com esse nome neste projeto.");
      } else {
        alert(`Erro ao salvar: ${error.message}`);
      }
      return;
    }
    setOpen(false);
    load();
  };

  const remove = async (id: string) => {
    if (!confirm("Remover este sprint?")) return;
    const supabase = createClient();
    await supabase.from("Sprint").delete().eq("id", id);
    load();
  };

  const fmt = (d: string) => new Date(d).toLocaleDateString("pt-BR", {
    day: "2-digit", month: "short",
  });

  const fmtRange = (start: string, end: string) => `${fmt(start)} — ${fmt(end)}`;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Sprints"
        onAdd={() => { setEditing(null); setOpen(true); }}
        addLabel="Novo Sprint"
      />

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
                  <span className="ml-auto">
                    <StatusChip tone="green" dot>
                      {activeSprint.name} — {activeSprint.taskStats.percent}%
                    </StatusChip>
                  </span>
                )}
              </button>

              {isExpanded && (
                <div className="border-t">
                  {projectSprints.map((s) => (
                    <div key={s.id} className="border-b last:border-b-0">
                      <div className="flex items-center gap-4 px-4 py-2.5 hover:bg-muted/30 transition-colors">
                        <div className="flex items-center gap-2 min-w-[160px]">
                          <StatusChip {...lookupChip(SPRINT_STATUS, s.status)} dot />
                          <span className="text-sm font-medium">{s.name}</span>
                        </div>
                        <span className="text-xs text-muted-foreground whitespace-nowrap">
                          {fmtRange(s.startDate, s.endDate)}
                        </span>
                        <span className="text-xs font-medium tabular-nums">{s.totalFp} FP</span>
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
                        <div className="flex items-center gap-1 shrink-0">
                          <Link href={`/sprints/${s.id}/board`}>
                            <Button variant="outline" size="sm" className="h-7 text-xs">
                              <KanbanSquare className="mr-1 h-3.5 w-3.5" />
                              Board
                            </Button>
                          </Link>
                          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => { setEditing(s); setOpen(true); }}>
                            <Pencil className="h-3 w-3" />
                          </Button>
                          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => remove(s.id)}>
                            <Trash2 className="h-3 w-3" />
                          </Button>
                        </div>
                      </div>

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

      <SprintDialog
        open={open}
        onOpenChange={setOpen}
        editing={editing}
        existingSprints={sprints}
        projects={projects}
        allSprints={sprints}
        onSave={handleSave}
      />
    </div>
  );
}
