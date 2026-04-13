"use client";

import React, { use, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Sheet, SheetContent,
} from "@/components/ui/sheet";
import {
  ArrowLeft, ExternalLink, Users, KanbanSquare, Plus,
  Lightbulb, ListTodo, Zap, Play, Trash2,
  CheckCircle2, Circle, Loader2, Eye, AlertCircle, BookOpen, CalendarRange,
  Calendar, Link2, CheckSquare, Code, Briefcase, Ban, Layout, FileText, Pencil, Bot, AlertTriangle,
} from "lucide-react";
import { ProjectGuidelines } from "@/components/project-guidelines";
import { ProjectWiki } from "@/components/project-wiki";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

// ─── Types ────────────────────────────────────────────────

type Member = { id: string; name: string; role: string };
type SquadMember = { id: string; member: Member };
type ProjectSquad = { id: string; squad: { id: string; name: string; members: SquadMember[] } };

type TaskAssignment = { member: { name: string } | null; agent: { name: string } | null };
type Task = {
  id: string; title: string; reference: string; status: string;
  complexity: string; scope: string; sprintId: string | null;
  sprint: { name: string } | null;
  assignments: TaskAssignment[];
  description?: string | null;
  type?: string;
  functionPoints?: number | null;
  dueDate?: string | null;
  executionMode?: string;
  dependencies?: string | null;
};

type FullTask = Task & {
  acceptanceCriteria: string | null;
  technicalNotes: string | null;
  businessContext: string | null;
  outOfScope: string | null;
  uiGuidance: string | null;
  iterations: {
    id: string; number: number; type: string; trigger: string;
    resultSummary: string | null; success: boolean;
    startedAt: string; completedAt: string | null;
  }[];
};

type SprintStats = { total: number; done: number; percent: number };
type Sprint = {
  id: string; name: string; startDate: string; endDate: string;
  status: string; taskStats: SprintStats;
};

type DesignSession = {
  id: string; title: string; type: string; status: string;
  currentStep: number; totalSteps: number; createdAt: string;
  _count: { items: number; stakeholders: number };
};

type TaskSummary = {
  total: number; backlog: number; todo: number;
  in_progress: number; review: number; done: number;
};

type ProjectHealth = {
  startDate: string | null;
  progressPercent: number;
  totalTasks: number;
  doneTasks: number;
  totalFp: number;
  doneFp: number;
  attentionLevel: "low" | "medium" | "high" | "urgent";
  attentionReasons: string[];
  overdueCount: number;
};

type MemberCapacity = {
  id: string;
  name: string;
  role: string;
  fpCapacity: number;
  fpThisProject: number;
  fpOtherProjects: number;
  fpTotal: number;
  totalPct: number;
  isOverloaded: boolean;
};

type Project = {
  id: string; name: string; repoUrl: string | null;
  startDate: string | null; endDate: string | null; contractUrl: string | null;
  status: string;
  client: { id: string; name: string };
  projectSquads: ProjectSquad[];
  sprints: Sprint[];
  tasks: Task[];
  designSessions: DesignSession[];
  taskSummary: TaskSummary;
  health: ProjectHealth;
  memberCapacity: MemberCapacity[];
};

// ─── Constants ────────────────────────────────────────────

const tabs = [
  { key: "overview", label: "Overview", icon: Eye },
  { key: "schedule", label: "Cronograma", icon: CalendarRange },
  { key: "sprints", label: "Sprints", icon: Zap },
  { key: "sessions", label: "Sessions", icon: Lightbulb },
  { key: "tasks", label: "Tasks", icon: ListTodo },
  { key: "guidelines", label: "Guidelines", icon: BookOpen },
  { key: "wiki", label: "Wiki", icon: FileText },
] as const;

type TabKey = (typeof tabs)[number]["key"];

const statusColors: Record<string, string> = {
  active: "bg-green-100 text-green-800",
  paused: "bg-yellow-100 text-yellow-800",
  completed: "bg-blue-100 text-blue-800",
  archived: "bg-gray-100 text-gray-800",
  draft: "bg-gray-100 text-gray-700",
  in_progress: "bg-yellow-100 text-yellow-700",
  done: "bg-green-100 text-green-700",
  planning: "bg-gray-100 text-gray-700",
};

const taskStatusIcons: Record<string, React.ReactNode> = {
  backlog: <Circle className="h-3.5 w-3.5 text-gray-400" />,
  todo: <Circle className="h-3.5 w-3.5 text-blue-500" />,
  in_progress: <Loader2 className="h-3.5 w-3.5 text-yellow-500" />,
  review: <Eye className="h-3.5 w-3.5 text-purple-500" />,
  done: <CheckCircle2 className="h-3.5 w-3.5 text-green-500" />,
};

const scopeWeights: Record<string, number> = { micro: 1, small: 2, medium: 4, large: 8 };

const typeLabels: Record<string, string> = {
  setup: "Setup", feature: "Feature", component: "Componente",
  seed: "Seed", bugfix: "Bugfix", refactor: "Refactor",
  management: "Gestao",
};
const typeColors: Record<string, string> = {
  setup: "bg-purple-100 text-purple-700", feature: "bg-blue-100 text-blue-700",
  component: "bg-teal-100 text-teal-700", seed: "bg-amber-100 text-amber-700",
  bugfix: "bg-red-100 text-red-700", refactor: "bg-gray-100 text-gray-700",
  management: "bg-pink-100 text-pink-700",
};

function fmtDate(d: string | null | undefined) {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("pt-BR", { day: "2-digit", month: "short" });
}
function isOverdue(d: string | null | undefined, status: string) {
  if (!d || status === "done") return false;
  return new Date(d) < new Date();
}

// ─── Main Page ────────────────────────────────────────────

export default function ProjectDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const [project, setProject] = useState<Project | null>(null);
  const [activeTab, setActiveTab] = useState<TabKey>("overview");
  const router = useRouter();

  const load = () =>
    fetch(`/api/projects/${id}`).then((r) => r.json()).then(setProject);

  useEffect(() => { load(); }, [id]);

  if (!project) {
    return <div className="p-6 text-muted-foreground">Carregando...</div>;
  }

  const activeSprint = project.sprints.find((s) => s.status === "active");

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-3">
          <Link href="/projects">
            <Button variant="ghost" size="icon" className="h-8 w-8">
              <ArrowLeft className="h-4 w-4" />
            </Button>
          </Link>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-2xl font-bold">{project.name}</h1>
              <Badge className={statusColors[project.status]}>{project.status}</Badge>
            </div>
            <p className="text-sm text-muted-foreground">{project.client.name}</p>
          </div>
        </div>
        {project.repoUrl && (
          <a href={project.repoUrl} target="_blank" rel="noopener noreferrer">
            <Button variant="outline" size="sm">
              <ExternalLink className="h-3.5 w-3.5 mr-1" /> Repo
            </Button>
          </a>
        )}
      </div>

      {/* Tabs */}
      <div className="flex gap-1 border-b">
        {tabs.map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={`flex items-center gap-1.5 px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
              activeTab === tab.key
                ? "border-primary text-primary"
                : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            <tab.icon className="h-4 w-4" />
            {tab.label}
            {tab.key === "tasks" && (
              <Badge variant="secondary" className="ml-1 h-5 text-xs">{project.taskSummary.total}</Badge>
            )}
            {tab.key === "sessions" && project.designSessions.length > 0 && (
              <Badge variant="secondary" className="ml-1 h-5 text-xs">{project.designSessions.length}</Badge>
            )}
          </button>
        ))}
      </div>

      {/* Tab content */}
      {activeTab === "overview" && (
        <OverviewTab project={project} activeSprint={activeSprint} />
      )}
      {activeTab === "schedule" && (
        <ScheduleTab projectId={project.id} />
      )}
      {activeTab === "sprints" && (
        <SprintsTab project={project} />
      )}
      {activeTab === "sessions" && (
        <SessionsTab project={project} onRefresh={load} />
      )}
      {activeTab === "tasks" && (
        <TasksTab project={project} />
      )}
      {activeTab === "guidelines" && (
        <ProjectGuidelines projectId={project.id} />
      )}
      {activeTab === "wiki" && (
        <ProjectWiki projectId={project.id} />
      )}
    </div>
  );
}

// ─── Overview Tab ─────────────────────────────────────────

function OverviewTab({ project, activeSprint }: { project: Project; activeSprint?: Sprint }) {
  const { taskSummary, health, memberCapacity } = project;

  const attentionConfig: Record<string, { label: string; color: string; bg: string }> = {
    low: { label: "Baixo", color: "text-green-400", bg: "bg-green-500/10" },
    medium: { label: "Medio", color: "text-yellow-400", bg: "bg-yellow-500/10" },
    high: { label: "Alto", color: "text-red-400", bg: "bg-red-500/10" },
    urgent: { label: "Urgencia", color: "text-red-400", bg: "bg-red-500/20" },
  };

  const attention = attentionConfig[health.attentionLevel] || attentionConfig.low;

  const fmtD = (d: string | null) =>
    d ? new Date(d).toLocaleDateString("pt-BR", { day: "2-digit", month: "short", year: "numeric" }) : "—";

  const roleLabels: Record<string, string> = {
    pm: "PM", fullstack: "Fullstack",
    "ui-ux-builder": "UI/UX", "backend-qa-builder": "Backend/QA",
  };

  return (
    <div className="space-y-4">
      {/* Row 1: Health + Sprint Ativo */}
      <div className="grid gap-4 lg:grid-cols-3">
        {/* Health card */}
        <Card className="lg:col-span-2">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm text-muted-foreground">Saude do Projeto</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Key metrics */}
            <div className="grid grid-cols-4 gap-3">
              <div>
                <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">Inicio</p>
                <p className="text-sm font-medium">{fmtD(health.startDate)}</p>
              </div>
              <div>
                <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">Fim</p>
                <p className="text-sm font-medium">{fmtD(project.endDate)}</p>
              </div>
              <div>
                <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">Tasks</p>
                <p className="text-sm font-medium">{health.doneTasks}/{health.totalTasks}</p>
              </div>
              <div>
                <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">FP</p>
                <p className="text-sm font-medium">{health.doneFp}/{health.totalFp}</p>
              </div>
            </div>

            {/* Progress bar */}
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-xs text-muted-foreground">Progresso</span>
                <span className="text-sm font-bold">{health.progressPercent}%</span>
              </div>
              <div className="h-2.5 w-full rounded-full bg-secondary overflow-hidden">
                <div
                  className={`h-full rounded-full transition-all ${health.progressPercent === 100 ? "bg-green-500" : "bg-primary"}`}
                  style={{ width: `${health.progressPercent}%` }}
                />
              </div>
            </div>

            {/* Attention level */}
            <div className="flex items-center gap-2">
              <div className={`h-2 w-2 rounded-full ${
                health.attentionLevel === "low" ? "bg-green-500" :
                health.attentionLevel === "medium" ? "bg-yellow-500" :
                "bg-red-500"
              }`} />
              <span className="text-xs text-muted-foreground">
                {health.attentionReasons[0]}
              </span>
            </div>
          </CardContent>
        </Card>

        {/* Sprint Ativo */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm text-muted-foreground flex items-center gap-1">
              <Zap className="h-3.5 w-3.5" /> Sprint Ativo
            </CardTitle>
          </CardHeader>
          <CardContent>
            {activeSprint ? (
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium">{activeSprint.name}</span>
                  <Link href={`/sprints/${activeSprint.id}/board`}>
                    <Button variant="outline" size="sm" className="h-7 text-xs">
                      <KanbanSquare className="h-3.5 w-3.5 mr-1" /> Board
                    </Button>
                  </Link>
                </div>
                <div className="text-xs text-muted-foreground">
                  {fmtD(activeSprint.startDate)} — {fmtD(activeSprint.endDate)}
                </div>
                <div className="flex items-center gap-2">
                  <div className="h-2 flex-1 rounded-full bg-muted overflow-hidden">
                    <div
                      className="h-full rounded-full bg-primary transition-all"
                      style={{ width: `${activeSprint.taskStats.percent}%` }}
                    />
                  </div>
                  <span className="text-xs font-medium tabular-nums">
                    {activeSprint.taskStats.done}/{activeSprint.taskStats.total}
                  </span>
                </div>

                {/* Task status breakdown */}
                <div className="space-y-1.5 pt-2 border-t border-foreground/5">
                  {(["backlog", "todo", "in_progress", "review", "done"] as const).map((status) => (
                    <div key={status} className="flex items-center justify-between text-sm">
                      <div className="flex items-center gap-2">
                        {taskStatusIcons[status]}
                        <span className="text-xs">{status}</span>
                      </div>
                      <span className="font-medium tabular-nums text-xs">{taskSummary[status]}</span>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">Nenhum sprint ativo.</p>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Row 2: Capacity + Sessions */}
      <div className="grid gap-4 lg:grid-cols-3">
        {/* Capacity */}
        <Card className="lg:col-span-2">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm text-muted-foreground flex items-center gap-1">
              <Users className="h-3.5 w-3.5" /> Capacity do Squad
            </CardTitle>
          </CardHeader>
          <CardContent>
            {memberCapacity.length === 0 ? (
              <p className="text-sm text-muted-foreground">Nenhum membro vinculado.</p>
            ) : (
              <div className="space-y-3">
                {memberCapacity.map((m) => {
                  const pct = m.fpCapacity > 0 ? m.fpThisProject / m.fpCapacity : 0;
                  return (
                    <div key={m.id} className="flex items-center gap-3">
                      <div className="flex items-center gap-2 w-40 shrink-0">
                        <span className="text-sm font-medium truncate">{m.name}</span>
                        {m.isOverloaded && (
                          <span title={`${m.name} esta em ${Math.round(m.totalPct * 100)}% de capacity total (inclui outros projetos)`}>
                            <AlertTriangle className="h-3.5 w-3.5 text-red-400 shrink-0" />
                          </span>
                        )}
                      </div>
                      <Badge variant="outline" className="text-[10px] shrink-0">
                        {roleLabels[m.role] || m.role}
                      </Badge>
                      <div className="h-2 flex-1 rounded-full bg-secondary overflow-hidden">
                        <div
                          className={`h-full rounded-full ${
                            pct <= 0.5 ? "bg-green-500" :
                            pct <= 0.7 ? "bg-blue-500" :
                            pct <= 0.85 ? "bg-yellow-500" : "bg-red-500"
                          }`}
                          style={{ width: `${Math.min(pct * 100, 100)}%` }}
                        />
                      </div>
                      <span className="text-xs font-medium tabular-nums w-16 text-right shrink-0">
                        {m.fpThisProject} FP
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Design Sessions */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm text-muted-foreground flex items-center gap-1">
              <Lightbulb className="h-3.5 w-3.5" /> Design Sessions
            </CardTitle>
          </CardHeader>
          <CardContent>
            {project.designSessions.length === 0 ? (
              <p className="text-sm text-muted-foreground">Nenhuma session ainda.</p>
            ) : (
              <div className="space-y-2">
                {project.designSessions.slice(0, 3).map((s) => (
                  <Link key={s.id} href={`/design-sessions/${s.id}/steps/${s.currentStep}`}>
                    <div className="flex items-center justify-between surface-inset p-2 hover:bg-muted/60 transition-colors">
                      <div>
                        <p className="text-sm font-medium">{s.title}</p>
                        <p className="text-xs text-muted-foreground">
                          {s.type === "inception" ? "Inception" : "Melhoria Continua"}
                        </p>
                      </div>
                      <Badge className={statusColors[s.status]}>{s.status}</Badge>
                    </div>
                  </Link>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

// ─── Sessions Tab ─────────────────────────────────────────

function SessionsTab({ project, onRefresh }: { project: Project; onRefresh: () => void }) {
  const router = useRouter();

  const typeLabels: Record<string, string> = {
    inception: "Inception",
    continuous_improvement: "Melhoria Continua",
  };

  const createSession = async (type: string) => {
    const title = type === "inception"
      ? `Inception ${project.name}`
      : `Melhoria ${project.name} — ${new Date().toLocaleDateString("pt-BR")}`;

    const res = await fetch("/api/design-sessions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ projectId: project.id, type, title }),
    });
    const session = await res.json();
    router.push(`/design-sessions/${session.id}/steps/0`);
  };

  const remove = async (id: string) => {
    if (!confirm("Remover esta session?")) return;
    await fetch(`/api/design-sessions/${id}`, { method: "DELETE" });
    onRefresh();
  };

  return (
    <div className="space-y-4">
      <div className="flex gap-2">
        <Button size="sm" onClick={() => createSession("inception")}>
          <Plus className="h-4 w-4 mr-1" /> Inception
        </Button>
        <Button size="sm" variant="outline" onClick={() => createSession("continuous_improvement")}>
          <Plus className="h-4 w-4 mr-1" /> Melhoria Continua
        </Button>
      </div>

      {project.designSessions.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground">
          <Lightbulb className="mx-auto h-8 w-8 mb-2 opacity-50" />
          <p>Nenhuma Design Session.</p>
          <p className="text-sm">Crie uma Inception para mapear o escopo do projeto.</p>
        </div>
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {project.designSessions.map((s) => (
            <Card key={s.id} className="hover:shadow-md transition-shadow">
              <CardContent className="p-4">
                <div className="flex items-start justify-between mb-2">
                  <div>
                    <p className="font-medium">{s.title}</p>
                    <Badge variant="outline" className="text-xs mt-1">{typeLabels[s.type]}</Badge>
                  </div>
                  <Badge className={statusColors[s.status]}>{s.status}</Badge>
                </div>

                <div className="mt-2 h-1.5 w-full rounded-full bg-muted overflow-hidden">
                  <div
                    className="h-full rounded-full bg-primary"
                    style={{ width: `${((s.currentStep + 1) / s.totalSteps) * 100}%` }}
                  />
                </div>

                <div className="mt-2 flex items-center justify-between text-xs text-muted-foreground">
                  <span>Step {s.currentStep + 1}/{s.totalSteps} · {s._count.stakeholders} stakeholders · {s._count.items} items</span>
                  <div className="flex gap-1">
                    <Link href={`/design-sessions/${s.id}/steps/${s.currentStep}`}>
                      <Button variant="ghost" size="icon" className="h-7 w-7">
                        <Play className="h-3.5 w-3.5" />
                      </Button>
                    </Link>
                    <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => remove(s.id)}>
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Tasks Tab ────────────────────────────────────────────

function TasksTab({ project }: { project: Project }) {
  const [filter, setFilter] = useState<string>("all");
  const [sheetOpen, setSheetOpen] = useState(false);
  const [selectedTask, setSelectedTask] = useState<FullTask | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);

  const filtered = filter === "all"
    ? project.tasks
    : project.tasks.filter((t) => t.status === filter);

  const openDetail = async (t: Task) => {
    setSheetOpen(true);
    setLoadingDetail(true);
    setSelectedTask(null);
    const res = await fetch(`/api/tasks/${t.id}`);
    const full = await res.json();
    setSelectedTask(full);
    setLoadingDetail(false);
  };

  return (
    <div className="space-y-4">
      {/* Filters */}
      <div className="flex gap-1 flex-wrap">
        {["all", "backlog", "todo", "in_progress", "review", "done"].map((s) => (
          <Button
            key={s}
            variant={filter === s ? "default" : "outline"}
            size="sm"
            className="h-7 text-xs"
            onClick={() => setFilter(s)}
          >
            {s === "all" ? "Todas" : s}
            <Badge variant="secondary" className="ml-1 h-4 text-xs">
              {s === "all" ? project.tasks.length : project.tasks.filter((t) => t.status === s).length}
            </Badge>
          </Button>
        ))}
      </div>

      {/* Task list */}
      <div className="space-y-1">
        {filtered.map((t) => {
          const overdue = isOverdue(t.dueDate, t.status);
          return (
            <div
              key={t.id}
              className="flex items-center gap-3 surface-inset p-3 hover:bg-muted/60 transition-colors cursor-pointer"
              onClick={() => openDetail(t)}
            >
              {taskStatusIcons[t.status]}
              <span className="font-mono text-xs text-muted-foreground w-[72px] shrink-0">{t.reference}</span>
              <span className="text-sm font-medium flex-1 truncate">{t.title}</span>
              {t.type && (
                <Badge className={`text-xs ${typeColors[t.type] || ""}`}>
                  {typeLabels[t.type] || t.type}
                </Badge>
              )}
              {t.functionPoints != null && (
                <span className="text-xs font-medium tabular-nums text-muted-foreground">{t.functionPoints} FP</span>
              )}
              {t.dueDate && (
                <span className={`text-xs tabular-nums ${overdue ? "text-red-600 font-medium" : "text-muted-foreground"}`}>
                  {fmtDate(t.dueDate)}
                </span>
              )}
              <Badge variant="outline" className="text-xs">{t.scope}</Badge>
              <div className="flex gap-1">
                {t.assignments.map((a, i) => (
                  <Badge key={i} variant="secondary" className="text-xs">
                    {a.member?.name || a.agent?.name}
                  </Badge>
                ))}
              </div>
            </div>
          );
        })}
        {filtered.length === 0 && (
          <p className="text-center text-muted-foreground py-8">Nenhuma task.</p>
        )}
      </div>

      {/* Detail Sheet */}
      <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
        <SheetContent className="w-full !sm:max-w-[680px] overflow-y-auto p-0">
          {loadingDetail || !selectedTask ? (
            <div className="py-12 text-center text-muted-foreground">Carregando...</div>
          ) : (
            <TaskDetailSheet task={selectedTask} />
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}

// ─── Task Detail Sheet (shared) ──────────────────────────

function TaskDetailSheet({ task }: { task: FullTask }) {
  const deps: string[] = task.dependencies ? JSON.parse(task.dependencies) : [];
  const overdue = isOverdue(task.dueDate, task.status);

  return (
    <div className="flex flex-col h-full">
      {/* ── Header ── */}
      <div className="border-b px-6 py-5">
        <div className="flex items-center gap-2 flex-wrap mb-2">
          <span className="font-mono text-xs text-muted-foreground bg-muted px-1.5 py-0.5 rounded">{task.reference}</span>
          {task.type && (
            <Badge className={typeColors[task.type] || "bg-gray-100 text-gray-700"}>
              {typeLabels[task.type] || task.type}
            </Badge>
          )}
          <Badge className={statusColors[task.status]}>{task.status}</Badge>
          {task.executionMode === "agent" && (
            <Badge variant="outline" className="text-xs gap-1"><Bot className="h-3 w-3" /> Agent</Badge>
          )}
        </div>
        <h2 className="text-lg font-semibold leading-snug">{task.title}</h2>
        {task.description && (
          <p className="text-sm text-muted-foreground mt-1.5 leading-relaxed">{task.description}</p>
        )}
      </div>

      {/* ── Body (scrollable) ── */}
      <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5">

        {/* Meta cards */}
        <div className="grid grid-cols-3 gap-3">
          <MetaItem label="Function Points" value={task.functionPoints != null ? `${task.functionPoints} FP` : "—"} icon={<Zap className="h-3.5 w-3.5" />} />
          <MetaItem
            label="Prazo"
            value={fmtDate(task.dueDate)}
            icon={<Calendar className="h-3.5 w-3.5" />}
            className={overdue ? "border-red-200 bg-red-50 text-red-700" : ""}
          />
          <MetaItem label="Sprint" value={task.sprint?.name || "—"} icon={<Zap className="h-3.5 w-3.5" />} />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <MetaItem label="Scope" value={task.scope} />
          <MetaItem label="Complexity" value={task.complexity} />
        </div>

        {/* Dependencies */}
        {deps.length > 0 && (
          <div className="surface-inset p-3">
            <div className="flex items-center gap-2 mb-2">
              <Link2 className="h-3.5 w-3.5 text-muted-foreground" />
              <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Dependencias</span>
            </div>
            <div className="flex gap-1.5 flex-wrap">
              {deps.map((ref) => (
                <Badge key={ref} variant="outline" className="font-mono text-xs">{ref}</Badge>
              ))}
            </div>
          </div>
        )}

        {/* ── Spec Sections ── */}
        {task.acceptanceCriteria && (
          <SpecSection icon={<CheckSquare className="h-4 w-4" />} title="Acceptance Criteria">
            <pre className="text-[13px] whitespace-pre-wrap font-sans leading-7">{task.acceptanceCriteria}</pre>
          </SpecSection>
        )}

        {task.technicalNotes && (
          <SpecSection icon={<Code className="h-4 w-4" />} title="Technical Notes">
            <pre className="text-xs whitespace-pre-wrap font-mono leading-relaxed bg-muted/60 border p-4 rounded-lg overflow-x-auto">{task.technicalNotes}</pre>
          </SpecSection>
        )}

        {task.businessContext && (
          <SpecSection icon={<Briefcase className="h-4 w-4" />} title="Business Context">
            <p className="text-sm leading-relaxed text-muted-foreground">{task.businessContext}</p>
          </SpecSection>
        )}

        {task.outOfScope && (
          <SpecSection icon={<Ban className="h-4 w-4" />} title="Out of Scope">
            <pre className="text-sm whitespace-pre-wrap font-sans leading-relaxed text-muted-foreground">{task.outOfScope}</pre>
          </SpecSection>
        )}

        {task.uiGuidance && (
          <SpecSection icon={<Layout className="h-4 w-4" />} title="UI Guidance">
            <p className="text-sm leading-relaxed text-muted-foreground">{task.uiGuidance}</p>
          </SpecSection>
        )}

        {task.iterations && task.iterations.length > 0 && (
          <SpecSection icon={<FileText className="h-4 w-4" />} title={`Historico (${task.iterations.length})`}>
            <div className="space-y-2">
              {task.iterations.map((it) => (
                <div key={it.id} className="flex items-start gap-3 text-sm border rounded-lg p-3">
                  <Badge variant={it.success ? "secondary" : "destructive"} className="text-xs mt-0.5">#{it.number}</Badge>
                  <div>
                    <p className="text-xs text-muted-foreground">{it.type} — {it.trigger}</p>
                    {it.resultSummary && <p className="text-xs mt-1">{it.resultSummary}</p>}
                  </div>
                </div>
              ))}
            </div>
          </SpecSection>
        )}
      </div>

      {/* ── Footer ── */}
      <div className="border-t px-6 py-4">
        <Link href={`/tasks/${task.id}`}>
          <Button size="sm">
            <Pencil className="h-3.5 w-3.5 mr-1.5" /> Abrir / Editar
          </Button>
        </Link>
      </div>
    </div>
  );
}

function MetaItem({ label, value, icon, className }: { label: string; value: string; icon?: React.ReactNode; className?: string }) {
  return (
    <div className={`rounded-lg border px-3 py-2 ${className || ""}`}>
      <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide mb-0.5">{label}</p>
      <div className="flex items-center gap-1.5">
        {icon && <span className="text-muted-foreground">{icon}</span>}
        <span className="text-sm font-medium">{value}</span>
      </div>
    </div>
  );
}

function SpecSection({ icon, title, children }: { icon: React.ReactNode; title: string; children: React.ReactNode }) {
  return (
    <div className="surface-inset p-4">
      <div className="flex items-center gap-2 mb-3">
        <span className="text-muted-foreground">{icon}</span>
        <h3 className="text-sm font-semibold">{title}</h3>
      </div>
      {children}
    </div>
  );
}

// ─── Sprints Tab ─────────────────────────────────────────

function SprintsTab({ project }: { project: Project }) {
  const [sprintsData, setSprintsData] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<any | null>(null);
  const [form, setForm] = useState({
    name: "", startDate: "", endDate: "", status: "planning",
  });

  const loadSprints = () => {
    setLoading(true);
    fetch("/api/sprints")
      .then((r) => r.json())
      .then((all) => {
        setSprintsData(all.filter((s: any) => s.projectId === project.id));
        setLoading(false);
      });
  };

  useEffect(() => { loadSprints(); }, [project.id]);

  const openNew = () => {
    setEditing(null);
    const today = new Date().toISOString().split("T")[0];
    const twoWeeks = new Date(Date.now() + 14 * 86400000).toISOString().split("T")[0];
    setForm({ name: "", startDate: today, endDate: twoWeeks, status: "planning" });
    setOpen(true);
  };

  const openEdit = (s: any) => {
    setEditing(s);
    setForm({
      name: s.name,
      startDate: s.startDate.split("T")[0],
      endDate: s.endDate.split("T")[0],
      status: s.status,
    });
    setOpen(true);
  };

  const save = async () => {
    const body = {
      name: form.name,
      startDate: new Date(form.startDate).toISOString(),
      endDate: new Date(form.endDate).toISOString(),
      status: form.status,
      projectId: project.id,
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
    loadSprints();
  };

  const remove = async (id: string) => {
    if (!confirm("Remover este sprint?")) return;
    await fetch(`/api/sprints/${id}`, { method: "DELETE" });
    loadSprints();
  };

  const fmt = (d: string) => new Date(d).toLocaleDateString("pt-BR", { day: "2-digit", month: "short" });

  const usageColor = (pct: number) => {
    if (pct <= 0.5) return "bg-green-500";
    if (pct <= 0.7) return "bg-blue-500";
    if (pct <= 0.85) return "bg-yellow-500";
    return "bg-red-500";
  };

  if (loading) return <p className="text-muted-foreground py-8 text-center">Carregando...</p>;

  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        <Button size="sm" onClick={openNew}>
          <Plus className="h-3.5 w-3.5 mr-1" /> Novo Sprint
        </Button>
      </div>

      {sprintsData.length === 0 && (
        <p className="text-center text-muted-foreground py-8">Nenhum sprint cadastrado.</p>
      )}

      {sprintsData.map((s) => (
        <div key={s.id} className="surface-inset overflow-hidden">
          {/* Sprint header */}
          <div className="flex items-center gap-4 p-4">
            <Badge className={statusColors[s.status]}>{s.status}</Badge>
            <div className="flex-1">
              <p className="text-sm font-medium">{s.name}</p>
              <p className="text-xs text-muted-foreground">{fmt(s.startDate)} — {fmt(s.endDate)}</p>
            </div>
            <span className="text-sm font-bold tabular-nums">{s.totalFp || 0} FP</span>
            <div className="flex items-center gap-2 min-w-[140px]">
              <div className="h-2 flex-1 rounded-full bg-secondary overflow-hidden">
                <div
                  className={`h-full rounded-full ${s.taskStats.percent === 100 ? "bg-green-500" : "bg-primary"}`}
                  style={{ width: `${s.taskStats.percent}%` }}
                />
              </div>
              <span className="text-xs font-medium tabular-nums">{s.taskStats.done}/{s.taskStats.total}</span>
            </div>
            <div className="flex items-center gap-1 shrink-0">
              <Link href={`/sprints/${s.id}/board`}>
                <Button variant="outline" size="sm" className="h-7 text-xs">
                  <KanbanSquare className="h-3.5 w-3.5 mr-1" /> Board
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
          {s.members && s.members.length > 0 && (
            <div className="border-t border-foreground/5 px-4 py-3">
              <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide mb-2">Capacity</p>
              <div className="space-y-1.5">
                {s.members.map((m: any) => {
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

      {/* Dialog de criar/editar sprint */}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editing ? "Editar Sprint" : "Novo Sprint"}</DialogTitle>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label>Nome</Label>
              <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Sprint 1" />
            </div>
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
            <Button variant="outline" onClick={() => setOpen(false)}>Cancelar</Button>
            <Button onClick={save} disabled={!form.name}>Salvar</Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ─── Schedule (Cronograma) Tab ───────────────────────────

type ScheduleTask = {
  id: string;
  reference: string;
  title: string;
  status: string;
  type: string;
  functionPoints: number | null;
  dueDate: string | null;
  executionMode: string;
  assignees: string[];
};

type ScheduleSprint = {
  id: string;
  name: string;
  startDate: string;
  endDate: string;
  status: string;
  totalTasks: number;
  tasksDone: number;
  totalFp: number;
  fpDone: number;
  tasks: ScheduleTask[];
};

function ScheduleTab({ projectId }: { projectId: string }) {
  const [schedule, setSchedule] = useState<ScheduleSprint[]>([]);
  const [loading, setLoading] = useState(true);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [selectedTask, setSelectedTask] = useState<FullTask | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);

  const openDetail = async (taskId: string) => {
    setSheetOpen(true);
    setLoadingDetail(true);
    setSelectedTask(null);
    const res = await fetch(`/api/tasks/${taskId}`);
    const full = await res.json();
    setSelectedTask(full);
    setLoadingDetail(false);
  };

  useEffect(() => {
    fetch(`/api/projects/${projectId}/schedule`)
      .then((r) => r.json())
      .then((data) => {
        setSchedule(data.schedule || []);
        setLoading(false);
      });
  }, [projectId]);

  if (loading) {
    return <p className="text-muted-foreground py-8 text-center">Carregando cronograma...</p>;
  }

  if (schedule.length === 0) {
    return (
      <div className="text-center py-12 text-muted-foreground">
        <CalendarRange className="mx-auto h-8 w-8 mb-2 opacity-50" />
        <p>Nenhum sprint cadastrado.</p>
        <p className="text-sm">Crie sprints para visualizar o cronograma do projeto.</p>
      </div>
    );
  }

  const now = new Date();
  const fmt = (d: string) =>
    new Date(d).toLocaleDateString("pt-BR", { day: "2-digit", month: "short" });

  const totalFp = schedule.reduce((s, sp) => s + sp.totalFp, 0);
  const totalFpDone = schedule.reduce((s, sp) => s + sp.fpDone, 0);
  const totalTasks = schedule.reduce((s, sp) => s + sp.totalTasks, 0);
  const totalDone = schedule.reduce((s, sp) => s + sp.tasksDone, 0);

  const sprintBorderColor: Record<string, string> = {
    planning: "border-l-muted-foreground/30",
    active: "border-l-primary",
    completed: "border-l-green-500",
  };

  const taskStatusIcon: Record<string, React.ReactNode> = {
    backlog: <Circle className="h-3.5 w-3.5 text-muted-foreground" />,
    todo: <Circle className="h-3.5 w-3.5 text-blue-400" />,
    in_progress: <Loader2 className="h-3.5 w-3.5 text-yellow-400" />,
    review: <Eye className="h-3.5 w-3.5 text-purple-400" />,
    changes_requested: <AlertCircle className="h-3.5 w-3.5 text-orange-400" />,
    approved: <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" />,
    done: <CheckCircle2 className="h-3.5 w-3.5 text-green-500" />,
  };

  return (
    <div className="space-y-6">
      {/* Summary */}
      <div className="grid grid-cols-4 gap-3">
        <div className="surface-inset px-3 py-2">
          <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">Sprints</p>
          <p className="text-lg font-bold">{schedule.length}</p>
        </div>
        <div className="surface-inset px-3 py-2">
          <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">Tasks</p>
          <p className="text-lg font-bold">{totalDone}<span className="text-sm font-normal text-muted-foreground">/{totalTasks}</span></p>
        </div>
        <div className="surface-inset px-3 py-2">
          <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">FP Entregues</p>
          <p className="text-lg font-bold">{totalFpDone}<span className="text-sm font-normal text-muted-foreground">/{totalFp}</span></p>
        </div>
        <div className="surface-inset px-3 py-2">
          <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">Progresso</p>
          <p className="text-lg font-bold">{totalTasks > 0 ? Math.round((totalDone / totalTasks) * 100) : 0}%</p>
        </div>
      </div>

      {/* Sprints with tasks */}
      {schedule.map((s) => {
        const progress = s.totalTasks > 0 ? Math.round((s.tasksDone / s.totalTasks) * 100) : 0;

        return (
          <div key={s.id} className="space-y-2">
            {/* Sprint header */}
            <div className={`surface-inset p-4 border-l-4 ${sprintBorderColor[s.status] || "border-l-muted-foreground/30"}`}>
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <h3 className="text-sm font-semibold">{s.name}</h3>
                  <Badge className={statusColors[s.status]}>{s.status}</Badge>
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-xs text-muted-foreground">{fmt(s.startDate)} — {fmt(s.endDate)}</span>
                  <span className="text-sm font-bold">{s.fpDone}/{s.totalFp} FP</span>
                  <Link href={`/sprints/${s.id}/board`}>
                    <Button variant="outline" size="sm" className="h-7 text-xs">
                      <KanbanSquare className="h-3.5 w-3.5 mr-1" /> Board
                    </Button>
                  </Link>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <div className="h-1.5 flex-1 rounded-full bg-secondary overflow-hidden">
                  <div
                    className={`h-full rounded-full transition-all ${progress === 100 ? "bg-green-500" : "bg-primary"}`}
                    style={{ width: `${progress}%` }}
                  />
                </div>
                <span className="text-xs font-medium tabular-nums">{s.tasksDone}/{s.totalTasks}</span>
              </div>
            </div>

            {/* Tasks list */}
            <div className="ml-4 border-l-2 border-muted pl-4 space-y-1">
              {s.tasks.map((t) => {
                const overdue = t.dueDate && t.status !== "done" && new Date(t.dueDate) < now;
                const isDone = t.status === "done";

                return (
                  <div
                    key={t.id}
                    className={`flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors cursor-pointer ${
                      isDone ? "opacity-60 hover:opacity-80" : "hover:bg-muted/20"
                    }`}
                    onClick={() => openDetail(t.id)}
                  >
                    {/* Status icon */}
                    {taskStatusIcon[t.status] || <Circle className="h-3.5 w-3.5 text-muted-foreground" />}

                    {/* Reference */}
                    <span className="font-mono text-xs text-muted-foreground w-[72px] shrink-0">{t.reference}</span>

                    {/* Title */}
                    <span className={`flex-1 truncate ${isDone ? "line-through" : ""}`}>{t.title}</span>

                    {/* Type */}
                    <Badge className={`text-[10px] px-1.5 ${typeColors[t.type] || "bg-muted text-muted-foreground"}`}>
                      {typeLabels[t.type] || t.type}
                    </Badge>

                    {/* FP */}
                    {t.functionPoints != null && (
                      <span className="text-xs font-medium tabular-nums text-muted-foreground w-8 text-right">{t.functionPoints}</span>
                    )}

                    {/* Assignee */}
                    <span className="text-xs text-muted-foreground w-24 truncate text-right">
                      {t.assignees[0] || "—"}
                    </span>

                    {/* Due date */}
                    <span className={`text-xs tabular-nums w-14 text-right ${
                      overdue ? "text-red-400 font-medium" : isDone ? "text-green-500" : "text-muted-foreground"
                    }`}>
                      {t.dueDate ? fmt(t.dueDate) : "—"}
                    </span>
                  </div>
                );
              })}

              {s.tasks.length === 0 && (
                <p className="text-xs text-muted-foreground py-3">Nenhuma task neste sprint.</p>
              )}
            </div>
          </div>
        );
      })}

      {/* Task Detail Sheet */}
      <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
        <SheetContent className="w-full !sm:max-w-[680px] overflow-y-auto p-0">
          {loadingDetail || !selectedTask ? (
            <div className="py-12 text-center text-muted-foreground">Carregando...</div>
          ) : (
            <TaskDetailSheet task={selectedTask} />
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}
