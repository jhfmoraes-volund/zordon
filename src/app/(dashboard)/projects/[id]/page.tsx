"use client";

import React, { use, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  ArrowLeft, ExternalLink, Users, KanbanSquare, Plus,
  Lightbulb, ListTodo, Zap, Play, Trash2,
  CheckCircle2, Circle, Loader2, Eye, AlertCircle, CalendarRange,
  FileText, Pencil, AlertTriangle, Settings, MoreVertical, Battery, Shield,
  Download,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
import { createClient } from "@/lib/supabase/client";
import { TaskSheet } from "@/components/task-sheet";
import { TaskList } from "@/components/task-list";
import { PageTitle } from "@/components/app-shell";
import { ProjectWiki } from "@/components/project-wiki";
import { SprintDialog } from "@/components/sprint-dialog";
import { PixelBar } from "@/components/ui/pixel-bar";
import { roleLabel, hasMinLevel, MANAGER, BUILDER } from "@/lib/roles";
import { StatusChip } from "@/components/ui/status-chip";
import { ProjectCapacityTab } from "@/components/project-capacity-tab";
import { ProjectAccessSheet } from "@/components/project-access-sheet";
import { SuperSessionModal } from "@/components/design-session/super-session-modal";
import {
  PROJECT_STATUS, SPRINT_STATUS, DESIGN_SESSION_STATUS, TASK_TYPE, lookupChip,
} from "@/lib/status-chips";

// ─── Types ────────────────────────────────────────────────

type Member = { id: string; name: string; role: string };
type SquadMember = { id: string; member: Member };
type ProjectSquad = { id: string; squad: { id: string; name: string; members: SquadMember[] } };

type TaskAssignment = { member: { id: string; name: string } | null };
type Task = {
  id: string; title: string; reference: string; status: string;
  complexity: string; scope: string; type: string; sprintId: string | null;
  sprint: { name: string } | null;
  assignments: TaskAssignment[];
  description?: string | null;
  functionPoints: number | null;
  dueDate: string | null;
  dependencies?: string[] | null;
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
  fpAllocation: number;
  fpAllocationOther: number;
  fpAllocationTotal: number;
};

type ProjectMemberRow = { member: { id: string; name: string; role: string } };

type Project = {
  id: string; name: string; repoUrl: string | null;
  startDate: string | null; endDate: string | null;
  status: string;
  clientId: string;
  pmId: string | null;
  githubRepoOwner: string | null;
  githubRepoName: string | null;
  githubDefaultBranch: string;
  client: { id: string; name: string };
  projectSquads: ProjectSquad[];
  projectMembers: ProjectMemberRow[];
  sprints: Sprint[];
  tasks: Task[];
  designSessions: DesignSession[];
  taskSummary: TaskSummary;
  health: ProjectHealth;
  memberCapacity: MemberCapacity[];
  viewerRole: string | null;
};

type ClientOption = { id: string; name: string };
type MemberOption = { id: string; name: string; role: string };

// ─── Constants ────────────────────────────────────────────

const tabs = [
  { key: "overview", label: "Overview", icon: Eye, minLevel: 0 },
  { key: "schedule", label: "Cronograma", icon: CalendarRange, minLevel: 0 },
  { key: "sprints", label: "Sprints", icon: Zap, minLevel: 0 },
  { key: "sessions", label: "Sessions", icon: Lightbulb, minLevel: 0 },
  { key: "tasks", label: "Tasks", icon: ListTodo, minLevel: 0 },
  { key: "capacity", label: "Capacity", icon: Battery, minLevel: MANAGER },
  { key: "wiki", label: "Wiki", icon: FileText, minLevel: 0 },
] as const;

type TabKey = (typeof tabs)[number]["key"];

const taskStatusIcons: Record<string, React.ReactNode> = {
  backlog: <Circle className="h-3.5 w-3.5 text-gray-400" />,
  todo: <Circle className="h-3.5 w-3.5 text-blue-500" />,
  in_progress: <Loader2 className="h-3.5 w-3.5 text-yellow-500" />,
  review: <Eye className="h-3.5 w-3.5 text-purple-500" />,
  done: <CheckCircle2 className="h-3.5 w-3.5 text-green-500" />,
};

const scopeWeights: Record<string, number> = { micro: 1, small: 2, medium: 4, large: 8 };

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

  // ─── Edit modal state ──────────────────────────────────
  const [editOpen, setEditOpen] = useState(false);
  const [accessOpen, setAccessOpen] = useState(false);
  const [clients, setClients] = useState<ClientOption[]>([]);
  const [allMembers, setAllMembers] = useState<MemberOption[]>([]);
  const [editForm, setEditForm] = useState({
    name: "", repoUrl: "", startDate: "", endDate: "",
    status: "active", clientId: "", pmId: "",
    githubRepoOwner: "", githubRepoName: "", githubDefaultBranch: "main",
    memberIds: [] as string[],
  });

  const load = () =>
    fetch(`/api/projects/${id}`).then((r) => r.json()).then(setProject);

  useEffect(() => { load(); }, [id]);

  const openSettings = async () => {
    if (!project) return;
    const supabase = createClient();
    const [clientsRes, membersRes] = await Promise.all([
      supabase.from("Client").select("id, name").order("name"),
      supabase.from("Member").select("id, name, role").order("name"),
    ]);
    if (clientsRes.data) setClients(clientsRes.data);
    if (membersRes.data) setAllMembers(membersRes.data);
    setEditForm({
      name: project.name,
      repoUrl: project.repoUrl || "",
      startDate: project.startDate ? project.startDate.slice(0, 10) : "",
      endDate: project.endDate ? project.endDate.slice(0, 10) : "",
      status: project.status,
      clientId: project.clientId,
      pmId: project.pmId || "",
      githubRepoOwner: project.githubRepoOwner || "",
      githubRepoName: project.githubRepoName || "",
      githubDefaultBranch: project.githubDefaultBranch || "main",
      memberIds: project.projectMembers.map((pm) => pm.member.id),
    });
    setEditOpen(true);
  };

  const saveSettings = async () => {
    const supabase = createClient();
    const projectData = {
      name: editForm.name,
      repoUrl: editForm.repoUrl || null,
      startDate: editForm.startDate ? new Date(editForm.startDate).toISOString() : null,
      endDate: editForm.endDate ? new Date(editForm.endDate).toISOString() : null,
      status: editForm.status,
      clientId: editForm.clientId,
      pmId: editForm.pmId || null,
      githubRepoOwner: editForm.githubRepoOwner || null,
      githubRepoName: editForm.githubRepoName || null,
      githubDefaultBranch: editForm.githubDefaultBranch || "main",
      updatedAt: new Date().toISOString(),
    };

    await supabase.from("Project").update(projectData).eq("id", id);

    // Sync project members — preserva fpAllocation existente, só adiciona/remove.
    const { data: existingMembers } = await supabase
      .from("ProjectMember")
      .select("memberId")
      .eq("projectId", id);
    const existingIds = new Set((existingMembers || []).map((m) => m.memberId));
    const nextIds = new Set(editForm.memberIds);

    const toRemove = Array.from(existingIds).filter((m) => !nextIds.has(m));
    const toAdd = Array.from(nextIds).filter((m) => !existingIds.has(m));

    if (toRemove.length > 0) {
      await supabase
        .from("ProjectMember")
        .delete()
        .eq("projectId", id)
        .in("memberId", toRemove);
    }
    if (toAdd.length > 0) {
      await supabase.from("ProjectMember").insert(
        toAdd.map((memberId) => ({
          id: crypto.randomUUID(),
          projectId: id,
          memberId,
          fpAllocation: 0,
        }))
      );
    }

    setEditOpen(false);
    load();
  };

  const toggleMember = (memberId: string) => {
    setEditForm((f) => ({
      ...f,
      memberIds: f.memberIds.includes(memberId)
        ? f.memberIds.filter((mid) => mid !== memberId)
        : [...f.memberIds, memberId],
    }));
  };

  if (!project) {
    return <div className="p-6 text-muted-foreground">Carregando...</div>;
  }

  const activeSprint = project.sprints.find((s) => s.status === "active");

  return (
    <div className="space-y-6">
      <PageTitle
        title={project.name}
        subtitle={`${project.client.name} · ${project.status}`}
      />
      {/* Header */}
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-3">
          <Link href="/projects">
            <Button variant="ghost" size="icon" className="h-8 w-8">
              <ArrowLeft className="h-4 w-4" />
            </Button>
          </Link>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h1 className="text-2xl font-bold truncate">{project.name}</h1>
              <StatusChip {...lookupChip(PROJECT_STATUS, project.status)} dot />
            </div>
            <p className="text-sm text-muted-foreground">{project.client.name}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {project.repoUrl && (
            <a href={project.repoUrl} target="_blank" rel="noopener noreferrer">
              <Button variant="outline" size="sm">
                <ExternalLink className="h-3.5 w-3.5 mr-1" /> Repo
              </Button>
            </a>
          )}
          {hasMinLevel(project.viewerRole, MANAGER) && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => setAccessOpen(true)}
              title="Gerenciar acesso"
            >
              <Shield className="h-3.5 w-3.5 mr-1" /> Acesso
            </Button>
          )}
          <Button variant="outline" size="icon" className="h-8 w-8" onClick={openSettings}>
            <Settings className="h-4 w-4" />
          </Button>
        </div>
      </div>

      <ProjectAccessSheet
        projectId={id}
        open={accessOpen}
        onOpenChange={setAccessOpen}
      />


      {/* Tabs */}
      <div className="flex gap-1 border-b overflow-x-auto scrollbar-none -mx-3 px-3 md:mx-0 md:px-0">
        {tabs
          .filter((tab) => hasMinLevel(project.viewerRole, tab.minLevel))
          .map((tab) => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`flex items-center gap-1.5 px-4 py-2 text-sm font-medium border-b-2 transition-colors whitespace-nowrap shrink-0 ${
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
        <TasksTab project={project} setProject={setProject} onRefresh={load} />
      )}
      {activeTab === "capacity" && hasMinLevel(project.viewerRole, MANAGER) && (
        <ProjectCapacityTab
          projectId={project.id}
          memberCapacity={project.memberCapacity}
          viewerRole={project.viewerRole}
          onRefresh={load}
        />
      )}
      {activeTab === "wiki" && (
        <ProjectWiki projectId={project.id} />
      )}

      {/* Edit Project Dialog */}
      <ResponsiveDialog open={editOpen} onOpenChange={setEditOpen}>
        <ResponsiveDialogContent>
          <ResponsiveDialogHeader>
            <ResponsiveDialogTitle>Editar Projeto</ResponsiveDialogTitle>
          </ResponsiveDialogHeader>
          <ResponsiveDialogBody className="grid gap-4 py-4 md:max-h-[70vh] md:overflow-y-auto md:pr-2">
            <div className="grid gap-2">
              <Label>Cliente</Label>
              <Select value={editForm.clientId} onValueChange={(v) => v && setEditForm({ ...editForm, clientId: v })}>
                <SelectTrigger>
                  <SelectValue placeholder="Selecione">
                    {(value: string | null) => clients.find((c) => c.id === value)?.name ?? "Selecione"}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {clients.map((c) => (
                    <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-2">
              <Label>PM Responsável</Label>
              <Select value={editForm.pmId} onValueChange={(v) => v && setEditForm({ ...editForm, pmId: v })}>
                <SelectTrigger>
                  <SelectValue placeholder="Selecione (opcional)">
                    {(value: string | null) => allMembers.find((m) => m.id === value)?.name ?? "Selecione (opcional)"}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {allMembers
                    .filter((m) => m.role === "pm")
                    .map((m) => (
                      <SelectItem key={m.id} value={m.id}>{m.name}</SelectItem>
                    ))}
                  {allMembers.filter((m) => m.role === "pm").length === 0 && (
                    <div className="px-2 py-1.5 text-xs text-muted-foreground">
                      Nenhum membro com role &quot;pm&quot; cadastrado
                    </div>
                  )}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-2">
              <Label>Membros Alocados</Label>
              <p className="text-xs text-muted-foreground">Clique para alocar/desalocar membros do projeto</p>
              <div className="flex flex-wrap gap-1.5 p-3 border rounded-md min-h-[40px]">
                {allMembers
                  .filter((m) => m.role !== "pm")
                  .map((m) => {
                    const isSelected = editForm.memberIds.includes(m.id);
                    return (
                      <Badge
                        key={m.id}
                        variant={isSelected ? "default" : "outline"}
                        className={`cursor-pointer text-xs transition-colors ${
                          isSelected ? "" : "opacity-50 hover:opacity-80"
                        }`}
                        onClick={() => toggleMember(m.id)}
                      >
                        {m.name}
                        <span className="ml-1 text-[10px]">
                          {roleLabel(m.role)}
                        </span>
                      </Badge>
                    );
                  })}
                {allMembers.filter((m) => m.role !== "pm").length === 0 && (
                  <span className="text-xs text-muted-foreground">Nenhum membro cadastrado</span>
                )}
              </div>
            </div>
            <div className="grid gap-2">
              <Label>Nome</Label>
              <Input value={editForm.name} onChange={(e) => setEditForm({ ...editForm, name: e.target.value })} />
            </div>
            <div className="grid gap-2">
              <Label>Repo URL</Label>
              <Input value={editForm.repoUrl} onChange={(e) => setEditForm({ ...editForm, repoUrl: e.target.value })} placeholder="https://github.com/..." />
            </div>
            <div className="grid grid-cols-3 gap-4">
              <div className="grid gap-2">
                <Label>GitHub Owner</Label>
                <Input value={editForm.githubRepoOwner} onChange={(e) => setEditForm({ ...editForm, githubRepoOwner: e.target.value })} placeholder="org-name" />
              </div>
              <div className="grid gap-2">
                <Label>GitHub Repo</Label>
                <Input value={editForm.githubRepoName} onChange={(e) => setEditForm({ ...editForm, githubRepoName: e.target.value })} placeholder="repo-name" />
              </div>
              <div className="grid gap-2">
                <Label>Default Branch</Label>
                <Input value={editForm.githubDefaultBranch} onChange={(e) => setEditForm({ ...editForm, githubDefaultBranch: e.target.value })} placeholder="main" />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="grid gap-2">
                <Label>Data Início</Label>
                <Input type="date" value={editForm.startDate} onChange={(e) => setEditForm({ ...editForm, startDate: e.target.value })} />
              </div>
              <div className="grid gap-2">
                <Label>Data Fim</Label>
                <Input type="date" value={editForm.endDate} onChange={(e) => setEditForm({ ...editForm, endDate: e.target.value })} />
              </div>
            </div>
            <div className="grid gap-2">
              <Label>Status</Label>
              <Select value={editForm.status} onValueChange={(v) => v && setEditForm({ ...editForm, status: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="active">Active</SelectItem>
                  <SelectItem value="paused">Paused</SelectItem>
                  <SelectItem value="completed">Completed</SelectItem>
                  <SelectItem value="archived">Archived</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </ResponsiveDialogBody>
          <ResponsiveDialogFooter>
            <Button variant="outline" onClick={() => setEditOpen(false)}>Cancelar</Button>
            <Button onClick={saveSettings} disabled={!editForm.name || !editForm.clientId}>Salvar</Button>
          </ResponsiveDialogFooter>
        </ResponsiveDialogContent>
      </ResponsiveDialog>

    </div>
  );
}

// ─── Overview Tab ─────────────────────────────────────────

function OverviewTab({ project, activeSprint }: { project: Project; activeSprint?: Sprint }) {
  const { taskSummary, health, memberCapacity } = project;
  const showCapacityCard = hasMinLevel(project.viewerRole, BUILDER);

  const attentionConfig: Record<string, { label: string; color: string; bg: string }> = {
    low: { label: "Baixo", color: "text-green-400", bg: "bg-green-500/10" },
    medium: { label: "Medio", color: "text-yellow-400", bg: "bg-yellow-500/10" },
    high: { label: "Alto", color: "text-red-400", bg: "bg-red-500/10" },
    urgent: { label: "Urgencia", color: "text-red-400", bg: "bg-red-500/20" },
  };

  const attention = attentionConfig[health.attentionLevel] || attentionConfig.low;

  const fmtD = (d: string | null) =>
    d ? new Date(d).toLocaleDateString("pt-BR", { day: "2-digit", month: "short", year: "numeric" }) : "—";

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
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
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
                  <Link href={`/sprints/${activeSprint.id}/board`} aria-label="Abrir board">
                    <Button variant="outline" size="sm" className="h-7 w-7 p-0">
                      <KanbanSquare className="h-3.5 w-3.5" />
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
        {/* Capacity — hidden from guests (allocation data) */}
        {showCapacityCard && (
        <Card className="lg:col-span-2">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm text-muted-foreground flex items-center gap-1">
              <Users className="h-3.5 w-3.5" /> Capacity do projeto
            </CardTitle>
          </CardHeader>
          <CardContent>
            {memberCapacity.length === 0 ? (
              <p className="text-sm text-muted-foreground">Nenhum membro vinculado.</p>
            ) : (
              <div className="space-y-3">
                {memberCapacity.map((m) => {
                  const pct = m.fpCapacity > 0 ? m.fpAllocation / m.fpCapacity : 0;
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
                        {roleLabel(m.role)}
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
                        {m.fpAllocation} FP
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>
        )}

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
                          {s.type === "inception"
                            ? "Inception"
                            : s.type === "super"
                              ? "Super Session"
                              : "Melhoria Continua"}
                        </p>
                      </div>
                      <StatusChip {...lookupChip(SPRINT_STATUS, s.status)} />
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
  const [superOpen, setSuperOpen] = useState(false);
  const [exportingId, setExportingId] = useState<string | null>(null);
  const isManager = hasMinLevel(project.viewerRole, MANAGER);

  const typeLabels: Record<string, string> = {
    inception: "Inception",
    continuous_improvement: "Melhoria Continua",
    super: "Super Session",
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

  const exportJson = async (id: string) => {
    setExportingId(id);
    try {
      const supabase = createClient();
      const { data: { session: authSession } } = await supabase.auth.getSession();
      if (!authSession) {
        alert("Sessão expirada. Faça login novamente.");
        return;
      }

      const url = `${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/export-design-session`;
      const res = await fetch(url, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${authSession.access_token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ sessionId: id }),
      });

      if (!res.ok) {
        alert(`Erro ao exportar: ${await res.text()}`);
        return;
      }

      const cd = res.headers.get("Content-Disposition") ?? "";
      const filename = cd.match(/filename="([^"]+)"/)?.[1] ?? `session-${id}.json`;
      const blob = await res.blob();
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(a.href);
    } finally {
      setExportingId(null);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex gap-2 flex-wrap">
        <Button size="sm" onClick={() => createSession("inception")}>
          <Plus className="h-4 w-4 mr-1" /> Inception
        </Button>
        <Button size="sm" variant="outline" onClick={() => createSession("continuous_improvement")}>
          <Plus className="h-4 w-4 mr-1" /> Melhoria Continua
        </Button>
        <Button size="sm" variant="outline" onClick={() => setSuperOpen(true)}>
          <Plus className="h-4 w-4 mr-1" /> Super Session
        </Button>
      </div>
      <SuperSessionModal
        projectId={project.id}
        projectName={project.name}
        open={superOpen}
        onOpenChange={setSuperOpen}
        onCreated={onRefresh}
      />

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
                  <StatusChip {...lookupChip(DESIGN_SESSION_STATUS, s.status)} dot />
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
                    <DropdownMenu>
                      <DropdownMenuTrigger
                        render={
                          <Button variant="ghost" size="icon" className="h-7 w-7">
                            <MoreVertical className="h-3.5 w-3.5" />
                          </Button>
                        }
                      />
                      <DropdownMenuContent align="end">
                        {isManager && (
                          <DropdownMenuItem
                            onClick={() => exportJson(s.id)}
                            disabled={exportingId === s.id}
                          >
                            <Download className="h-3.5 w-3.5" />
                            {exportingId === s.id ? "Exportando…" : "Exportar JSON"}
                          </DropdownMenuItem>
                        )}
                        <DropdownMenuItem variant="destructive" onClick={() => remove(s.id)}>
                          <Trash2 className="h-3.5 w-3.5" />
                          Excluir
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
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

function TasksTab({
  project,
  setProject,
  onRefresh,
}: {
  project: Project;
  setProject: React.Dispatch<React.SetStateAction<Project | null>>;
  onRefresh: () => void;
}) {
  const [filter, setFilter] = useState<string>("all");
  const [sheetOpen, setSheetOpen] = useState(false);
  const [sheetTaskId, setSheetTaskId] = useState<string | null>(null);

  const filtered = filter === "all"
    ? project.tasks
    : project.tasks.filter((t) => t.status === filter);

  const members = project.projectMembers.map((pm) => ({
    id: pm.member.id,
    name: pm.member.name,
    role: pm.member.role,
  }));

  const patchTask = (taskId: string, patch: Partial<Task>) => {
    setProject((prev) =>
      prev
        ? { ...prev, tasks: prev.tasks.map((t) => (t.id === taskId ? { ...t, ...patch } : t)) }
        : prev
    );
  };

  const handleStatusChange = async (taskId: string, status: string) => {
    patchTask(taskId, { status });
    const res = await fetch(`/api/tasks/${taskId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    });
    if (!res.ok) onRefresh();
  };

  const handleAssigneeChange = async (taskId: string, memberId: string | null) => {
    const member = memberId ? members.find((m) => m.id === memberId) : null;
    patchTask(taskId, {
      assignments: member ? [{ member: { id: member.id, name: member.name } }] : [],
    });
    const assigneeIds = memberId ? [{ memberId }] : [];
    const res = await fetch(`/api/tasks/${taskId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ assigneeIds }),
    });
    if (!res.ok) onRefresh();
  };

  const handleSprintChange = async (taskId: string, sprintId: string | null) => {
    const sprint = sprintId ? project.sprints.find((s) => s.id === sprintId) : null;
    patchTask(taskId, {
      sprintId,
      sprint: sprint ? { name: sprint.name } : null,
    });
    const res = await fetch(`/api/tasks/${taskId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sprintId }),
    });
    if (!res.ok) onRefresh();
  };

  const handleDelete = async (taskId: string) => {
    await fetch(`/api/tasks/${taskId}`, { method: "DELETE" });
    onRefresh();
  };

  return (
    <div className="space-y-4">
      {/* Header: filters + create */}
      <div className="flex items-center justify-between gap-4">
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
        <Button
          size="sm"
          className="h-7 text-xs shrink-0"
          onClick={() => { setSheetTaskId(null); setSheetOpen(true); }}
        >
          <Plus className="h-3.5 w-3.5 mr-1" />
          Criar Task
        </Button>
      </div>

      <TaskList
        tasks={filtered}
        members={members}
        sprints={project.sprints.map((s) => ({ id: s.id, name: s.name }))}
        onOpenDetail={(id) => { setSheetTaskId(id); setSheetOpen(true); }}
        onStatusChange={handleStatusChange}
        onAssigneeChange={handleAssigneeChange}
        onSprintChange={handleSprintChange}
        onDelete={handleDelete}
        showSprint
      />

      {/* Task Sheet (detail + create) */}
      <TaskSheet
        taskId={sheetTaskId}
        open={sheetOpen}
        onOpenChange={(open) => {
          setSheetOpen(open);
          if (!open) onRefresh();
        }}
        createDefaults={{
          projectId: project.id,
        }}
        onChange={onRefresh}
      />
    </div>
  );
}

// ─── Sprints Tab ─────────────────────────────────────────

function SprintsTab({ project }: { project: Project }) {
  const [sprintsData, setSprintsData] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<any | null>(null);

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

  const handleSave = async (data: { name: string; startDate: string; endDate: string; status: string }) => {
    const body = {
      name: data.name,
      startDate: new Date(data.startDate).toISOString(),
      endDate: new Date(data.endDate).toISOString(),
      status: data.status,
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

  if (loading) return <p className="text-muted-foreground py-8 text-center">Carregando...</p>;

  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        <Button size="sm" onClick={() => { setEditing(null); setOpen(true); }}>
          <Plus className="h-3.5 w-3.5 mr-1" /> Novo Sprint
        </Button>
      </div>

      {sprintsData.length === 0 && (
        <p className="text-center text-muted-foreground py-8">Nenhum sprint cadastrado.</p>
      )}

      {/* Mobile: vertical feed of tall cards */}
      <div className="space-y-3 md:hidden">
        {sprintsData.map((s) => (
          <Link
            key={s.id}
            href={`/sprints/${s.id}/board`}
            className="surface-inset block overflow-hidden relative active:bg-accent/40 transition-colors"
          >
            {/* 3-dot menu — absolute, stops propagation */}
            <div
              className="absolute top-2 right-2 z-10"
              onClick={(e) => {
                e.stopPropagation();
                e.preventDefault();
              }}
            >
              <DropdownMenu>
                <DropdownMenuTrigger
                  render={<Button variant="ghost" size="icon" className="h-9 w-9" />}
                >
                  <MoreVertical className="h-4 w-4" />
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onClick={() => { setEditing(s); setOpen(true); }}>
                    <Pencil className="h-3.5 w-3.5 mr-2" /> Editar
                  </DropdownMenuItem>
                  <DropdownMenuItem variant="destructive" onClick={() => remove(s.id)}>
                    <Trash2 className="h-3.5 w-3.5 mr-2" /> Excluir
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>

            <div className="p-4 space-y-3">
              {/* Header: badge + dates, name */}
              <div className="pr-10 space-y-1.5">
                <div className="flex items-center gap-2 flex-wrap">
                  <StatusChip {...lookupChip(SPRINT_STATUS, s.status)} dot />
                  <span className="text-xs text-muted-foreground tabular-nums">
                    {fmt(s.startDate)} → {fmt(s.endDate)}
                  </span>
                </div>
                <h3 className="font-medium text-base leading-tight">{s.name}</h3>
              </div>

              {/* Progress + FP */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-mono tabular-nums text-muted-foreground">
                    {s.taskStats.done}/{s.taskStats.total} tasks
                  </span>
                  <span className="font-bold tabular-nums">{s.totalFp || 0} FP</span>
                </div>
                <PixelBar score={s.taskStats.percent} cells={20} height={10} variant="skill" />
              </div>
            </div>

            {/* Capacity per member */}
            {s.members && s.members.length > 0 && (
              <div className="border-t border-foreground/5 px-4 py-3">
                <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide mb-2">Capacity</p>
                <div className="space-y-1.5">
                  {s.members.map((m: any) => {
                    const pct = m.fpCapacity > 0 ? (m.fpAllocated / m.fpCapacity) * 100 : 0;
                    return (
                      <div key={m.id} className="flex items-center gap-2">
                        <span className="text-xs w-24 truncate">{m.name}</span>
                        <div className="flex-1">
                          <PixelBar score={Math.min(pct, 100)} cells={14} height={8} variant="load" />
                        </div>
                        <span className="font-mono text-[10px] tabular-nums text-muted-foreground w-12 text-right leading-none">
                          {m.fpAllocated}/{m.fpCapacity}
                        </span>
                        <span className="font-mono text-[10px] tabular-nums font-medium w-8 text-right leading-none">
                          {Math.round(pct)}%
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </Link>
        ))}
      </div>

      {/* Desktop: single-row layout */}
      <div className="hidden md:block space-y-3">
        {sprintsData.map((s) => (
          <div key={s.id} className="surface-inset overflow-hidden">
            {/* Sprint header */}
            <div className="flex items-center gap-4 p-4">
              <StatusChip {...lookupChip(SPRINT_STATUS, s.status)} dot />
              <div className="flex-1">
                <p className="text-sm font-medium">{s.name}</p>
                <p className="text-xs text-muted-foreground">{fmt(s.startDate)} — {fmt(s.endDate)}</p>
              </div>
              <span className="text-sm font-bold tabular-nums">{s.totalFp || 0} FP</span>
              <div className="flex items-center gap-2 w-32 shrink-0">
                <div className="flex-1">
                  <PixelBar score={s.taskStats.percent} cells={16} height={8} variant="skill" />
                </div>
                <span className="font-mono text-[10px] tabular-nums text-muted-foreground leading-none">
                  {s.taskStats.done}/{s.taskStats.total}
                </span>
              </div>
              <div className="flex items-center gap-1 shrink-0">
                <Link href={`/sprints/${s.id}/board`} aria-label="Abrir board">
                  <Button variant="outline" size="sm" className="h-7 w-7 p-0">
                    <KanbanSquare className="h-3.5 w-3.5" />
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

            {/* Capacity per member */}
            {s.members && s.members.length > 0 && (
              <div className="border-t border-foreground/5 px-4 py-3">
                <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide mb-2">Capacity</p>
                <div className="space-y-1.5">
                  {s.members.map((m: any) => {
                    const pct = m.fpCapacity > 0 ? (m.fpAllocated / m.fpCapacity) * 100 : 0;
                    return (
                      <div key={m.id} className="flex items-center gap-2">
                        <span className="text-xs w-28 truncate">{m.name}</span>
                        <div className="flex-1">
                          <PixelBar score={Math.min(pct, 100)} cells={14} height={8} variant="load" />
                        </div>
                        <span className="font-mono text-[10px] tabular-nums text-muted-foreground w-14 text-right leading-none">
                          {m.fpAllocated}/{m.fpCapacity}
                        </span>
                        <span className="font-mono text-[10px] tabular-nums font-medium w-8 text-right leading-none">
                          {Math.round(pct)}%
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

      <SprintDialog
        open={open}
        onOpenChange={setOpen}
        editing={editing}
        existingSprints={sprintsData}
        onSave={handleSave}
      />
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
  const [sheetTaskId, setSheetTaskId] = useState<string | null>(null);

  const openDetail = (taskId: string) => {
    setSheetTaskId(taskId);
    setSheetOpen(true);
  };

  const reload = () => {
    fetch(`/api/projects/${projectId}/schedule`)
      .then((r) => r.json())
      .then((data) => {
        setSchedule(data.schedule || []);
      });
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
                  <StatusChip {...lookupChip(SPRINT_STATUS, s.status)} dot />
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-xs text-muted-foreground">{fmt(s.startDate)} — {fmt(s.endDate)}</span>
                  <span className="text-sm font-bold">{s.fpDone}/{s.totalFp} FP</span>
                  <Link href={`/sprints/${s.id}/board`} aria-label="Abrir board">
                    <Button variant="outline" size="sm" className="h-7 w-7 p-0">
                      <KanbanSquare className="h-3.5 w-3.5" />
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
                    <StatusChip {...lookupChip(TASK_TYPE, t.type)} />

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

      {/* Task Sheet */}
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
