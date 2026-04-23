"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  User, Zap, FolderKanban, ListTodo, ArrowRight,
} from "lucide-react";
import { useAuth } from "@/contexts/auth-context";
import { TaskSheet } from "@/components/task-sheet";
import {
  STATUS_LABELS, STATUS_COLORS,
  TYPE_LABELS, TYPE_COLORS,
  fmtDate, isOverdue,
} from "@/lib/task-constants";
import { roleLabel, specialtyLabel } from "@/lib/roles";

// ─── Types ────────────────────────────────────────────────

type MeTask = {
  id: string;
  title: string;
  reference: string;
  status: string;
  type: string;
  functionPoints: number | null;
  dueDate: string | null;
  sprintId: string | null;
  projectId: string;
  project: { name: string };
  sprint: { id: string; name: string } | null;
};

type MeSprint = {
  id: string;
  name: string;
  projectName: string;
  taskCount: number;
  fpTotal: number;
  doneCount: number;
};

type MeProject = {
  id: string;
  name: string;
  status: string;
};

type MeData = {
  member: { id: string; name: string; role: string; fpCapacity: number };
  fpAllocated: number;
  tasks: MeTask[];
  sprints: MeSprint[];
  projects: MeProject[];
};

// ─── Page ─────────────────────────────────────────────────

export default function ProfilePage() {
  const { member } = useAuth();
  const [data, setData] = useState<MeData | null>(null);
  const [loading, setLoading] = useState(true);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [sheetTaskId, setSheetTaskId] = useState<string | null>(null);

  const ACTIVE_STATUSES = ["todo", "in_progress", "review"];
  const FETCH_STATUSES = [...ACTIVE_STATUSES, "backlog"];

  const fetchProfile = async (memberId: string, memberInfo: typeof member) => {
    const supabase = createClient();
    const [assignmentsRes, allocationsRes] = await Promise.all([
      supabase
        .from("TaskAssignment")
        .select("*, task:Task(id, title, reference, status, type, functionPoints, dueDate, sprintId, projectId, project:Project(name), sprint:Sprint(id, name))")
        .eq("memberId", memberId),
      supabase
        .from("ProjectMember")
        .select("*, project:Project(id, name, status)")
        .eq("memberId", memberId),
    ]);

    const assignments = (assignmentsRes.data ?? []) as { task: MeTask & { sprint: { id: string; name: string } | null } }[];
    const tasks = assignments
      .map((a) => a.task)
      .filter((t) => FETCH_STATUSES.includes(t.status));
    const projects = (allocationsRes.data ?? []).map((pa: { project: MeProject }) => pa.project);

    // FP allocated (active only)
    const fpAllocated = tasks
      .filter((t) => ACTIVE_STATUSES.includes(t.status))
      .reduce((sum, t) => sum + (t.functionPoints ?? 0), 0);

    // Sprints where I have tasks
    const sprintMap = new Map<string, MeSprint>();
    for (const t of tasks) {
      if (!t.sprint) continue;
      const existing = sprintMap.get(t.sprint.id);
      if (existing) {
        existing.taskCount++;
        existing.fpTotal += t.functionPoints ?? 0;
        if (t.status === "done") existing.doneCount++;
      } else {
        sprintMap.set(t.sprint.id, {
          id: t.sprint.id,
          name: t.sprint.name,
          projectName: t.project.name,
          taskCount: 1,
          fpTotal: t.functionPoints ?? 0,
          doneCount: t.status === "done" ? 1 : 0,
        });
      }
    }

    return {
      member: { id: memberId, name: memberInfo!.name, role: memberInfo!.role, fpCapacity: memberInfo!.fpCapacity },
      fpAllocated,
      tasks,
      sprints: Array.from(sprintMap.values()),
      projects,
    } as MeData;
  };

  const reload = () => {
    if (!member) return;
    fetchProfile(member.id, member).then(setData).catch(() => {});
  };

  useEffect(() => {
    if (!member) return;
    setLoading(true);
    fetchProfile(member.id, member)
      .then(setData)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [member?.id]);

  if (!member) {
    return (
      <div className="py-12 text-center text-muted-foreground">
        Sua conta ainda não está vinculada a um membro. Peça ao admin.
      </div>
    );
  }

  if (loading || !data) {
    return <div className="py-12 text-center text-muted-foreground">Carregando...</div>;
  }

  const capacityPct = data.member.fpCapacity > 0
    ? Math.round((data.fpAllocated / data.member.fpCapacity) * 100)
    : 0;
  const isOverloaded = capacityPct > 85;

  // Sort tasks: in_progress first, then review, todo, backlog
  const statusOrder: Record<string, number> = {
    in_progress: 0, review: 1, todo: 2, backlog: 3,
  };
  const sortedTasks = [...data.tasks].sort(
    (a, b) => (statusOrder[a.status] ?? 9) - (statusOrder[b.status] ?? 9)
  );

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-4">
        <div className="flex items-center justify-center h-12 w-12 rounded-full bg-primary/10 text-primary">
          <User className="h-6 w-6" />
        </div>
        <div>
          <h1 className="text-2xl font-bold">{data.member.name}</h1>
          <p className="text-sm text-muted-foreground">
            {roleLabel(data.member.role)}
          </p>
        </div>
      </div>

      {/* Capacity card */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-xs text-muted-foreground flex items-center gap-1.5">
              <Zap className="h-3.5 w-3.5" /> Capacity
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-baseline gap-2">
              <span className={`text-2xl font-bold ${isOverloaded ? "text-red-500" : ""}`}>
                {data.fpAllocated}
              </span>
              <span className="text-sm text-muted-foreground">/ {data.member.fpCapacity} FP</span>
            </div>
            <div className="mt-2 h-2 rounded-full bg-muted overflow-hidden">
              <div
                className={`h-full rounded-full transition-all ${
                  isOverloaded ? "bg-red-500" : capacityPct > 60 ? "bg-yellow-500" : "bg-green-500"
                }`}
                style={{ width: `${Math.min(capacityPct, 100)}%` }}
              />
            </div>
            <p className="text-xs text-muted-foreground mt-1">{capacityPct}% alocado</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-xs text-muted-foreground flex items-center gap-1.5">
              <ListTodo className="h-3.5 w-3.5" /> Tasks Ativas
            </CardTitle>
          </CardHeader>
          <CardContent>
            <span className="text-2xl font-bold">{data.tasks.length}</span>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-xs text-muted-foreground flex items-center gap-1.5">
              <FolderKanban className="h-3.5 w-3.5" /> Projetos
            </CardTitle>
          </CardHeader>
          <CardContent>
            <span className="text-2xl font-bold">{data.projects.length}</span>
          </CardContent>
        </Card>
      </div>

      {/* My Tasks */}
      <div className="space-y-3">
        <h2 className="text-lg font-semibold">Minhas Tasks</h2>
        {sortedTasks.length > 0 ? (
          <div className="surface rounded-lg">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[90px]">Ref</TableHead>
                  <TableHead>Titulo</TableHead>
                  <TableHead className="w-[90px]">Tipo</TableHead>
                  <TableHead>Projeto</TableHead>
                  <TableHead>Sprint</TableHead>
                  <TableHead className="w-[120px]">Status</TableHead>
                  <TableHead className="w-[50px] text-center">FP</TableHead>
                  <TableHead className="w-[80px]">Prazo</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sortedTasks.map((t) => {
                  return (
                    <TableRow
                      key={t.id}
                      className="cursor-pointer hover:bg-muted/50"
                      onClick={() => { setSheetTaskId(t.id); setSheetOpen(true); }}
                    >
                      <TableCell className="font-mono text-xs text-primary">
                        {t.reference}
                      </TableCell>
                      <TableCell className="text-sm font-medium">
                        {t.title}
                      </TableCell>
                      <TableCell>
                        <Badge className={`text-xs ${TYPE_COLORS[t.type] || "bg-gray-100 text-gray-700"}`}>
                          {TYPE_LABELS[t.type] || t.type}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">{t.project.name}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">{t.sprint?.name || "—"}</TableCell>
                      <TableCell>
                        <Badge className={`text-xs ${STATUS_COLORS[t.status] || ""}`}>
                          {STATUS_LABELS[t.status] || t.status}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-center">
                        <span className="font-medium tabular-nums text-sm">{t.functionPoints ?? "—"}</span>
                      </TableCell>
                      <TableCell>
                        <span className={`text-xs tabular-nums ${isOverdue(t.dueDate, t.status) ? "text-red-600 font-medium" : "text-muted-foreground"}`}>
                          {fmtDate(t.dueDate)}
                        </span>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        ) : (
          <div className="surface p-8 text-center text-muted-foreground">
            Nenhuma task atribuida.
          </div>
        )}
      </div>

      {/* My Sprints */}
      {data.sprints.length > 0 && (
        <div className="space-y-3">
          <h2 className="text-lg font-semibold">Meus Sprints</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {data.sprints.map((s) => {
              const pct = s.taskCount > 0 ? Math.round((s.doneCount / s.taskCount) * 100) : 0;
              return (
                <Link key={s.id} href={`/sprints/${s.id}/board`}>
                  <Card className="hover:border-primary/30 transition-colors cursor-pointer">
                    <CardContent className="p-4">
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-sm font-semibold">{s.name}</span>
                        <ArrowRight className="h-3.5 w-3.5 text-muted-foreground" />
                      </div>
                      <p className="text-xs text-muted-foreground mb-2">{s.projectName}</p>
                      <div className="flex items-center gap-3 text-xs">
                        <span>{s.taskCount} tasks</span>
                        <span>{s.fpTotal} FP</span>
                        <span className="text-muted-foreground">{pct}% concluido</span>
                      </div>
                      <div className="mt-2 h-1.5 rounded-full bg-muted overflow-hidden">
                        <div className="h-full rounded-full bg-green-500" style={{ width: `${pct}%` }} />
                      </div>
                    </CardContent>
                  </Card>
                </Link>
              );
            })}
          </div>
        </div>
      )}

      {/* My Projects */}
      {data.projects.length > 0 && (
        <div className="space-y-3">
          <h2 className="text-lg font-semibold">Meus Projetos</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {data.projects.map((p) => (
              <Link key={p.id} href={`/projects/${p.id}`}>
                <Card className="hover:border-primary/30 transition-colors cursor-pointer">
                  <CardContent className="p-4 flex items-center justify-between">
                    <div>
                      <span className="text-sm font-semibold">{p.name}</span>
                      <Badge variant="secondary" className="ml-2 text-xs">{p.status}</Badge>
                    </div>
                    <ArrowRight className="h-3.5 w-3.5 text-muted-foreground" />
                  </CardContent>
                </Card>
              </Link>
            ))}
          </div>
        </div>
      )}

      <TaskSheet
        taskId={sheetTaskId}
        open={sheetOpen}
        onOpenChange={(open) => {
          setSheetOpen(open);
          if (!open) reload();
        }}
        onChange={reload}
      />
    </div>
  );
}
