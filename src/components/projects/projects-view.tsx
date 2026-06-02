"use client";

import React, { useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { PageHeader } from "@/components/page-header";
import { PageContainer } from "@/components/app-shell";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Pencil, Trash2, Users, ChevronDown, ChevronRight, MoreVertical, ListChecks } from "lucide-react";
import { hasMinAccessLevel, roleLabel } from "@/lib/roles";
import { StatusChip } from "@/components/ui/status-chip";
import { PROJECT_STATUS, lookupChip } from "@/lib/status-chips";
import { useOptimisticCollection } from "@/hooks/use-optimistic-collection";
import {
  ProjectEditSheet,
  type ProjectEditInitial,
} from "@/components/projects/project-edit-sheet";
import { fmtDate } from "@/lib/date-utils";
import { ConfirmDialog, type ConfirmState } from "@/components/ui/confirm-dialog";
import { toast } from "sonner";
import { useAuth } from "@/contexts/auth-context";
import { cn } from "@/lib/utils";

export type ProjectMemberAlloc = {
  id: string;
  member: { id: string; name: string; role: string; position: string | null };
};

export type Project = {
  id: string;
  name: string;
  repoUrl: string | null;
  startDate: string | null;
  endDate: string | null;
  status: string;
  category: string;
  phase: string;
  engagementType: string;
  clientId: string;
  githubRepoOwner: string | null;
  githubRepoName: string | null;
  githubDefaultBranch: string;
  pmId: string | null;
  client: { name: string };
  pm: { id: string; name: string } | null;
  projectMembers: ProjectMemberAlloc[];
  taskCount: number;
};

export type Client = { id: string; name: string };
export type Member = { id: string; name: string; role: string; position: string | null };

export type ProjectsViewInitial = {
  projects: Project[];
  clients: Client[];
  members: Member[];
};

function ProjectCardMobile({
  p,
  onEdit,
  onDelete,
}: {
  p: Project;
  onEdit: () => void;
  onDelete: () => void;
}) {
  return (
    <Link
      href={`/projects/${p.id}`}
      className="surface block p-4 space-y-3 relative active:bg-accent/40 transition-colors"
    >
      {/* Menu 3-dots — absolute, stops propagation */}
      <div
        className="absolute top-2 right-2"
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
            <DropdownMenuItem onClick={onEdit}>
              <Pencil className="h-3.5 w-3.5 mr-2" />
              Editar
            </DropdownMenuItem>
            <DropdownMenuItem variant="destructive" onClick={onDelete}>
              <Trash2 className="h-3.5 w-3.5 mr-2" />
              Excluir
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {/* Header: name + client */}
      <div className="pr-10 space-y-0.5">
        <h3 className="font-medium text-base leading-tight truncate">{p.name}</h3>
        <p className="text-xs text-muted-foreground truncate">{p.client.name}</p>
      </div>

      {/* Badges row: status + período */}
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <StatusChip {...lookupChip(PROJECT_STATUS, p.status)} dot />
        <span className="text-muted-foreground tabular-nums">
          {fmtDate(p.startDate)} → {fmtDate(p.endDate)}
        </span>
      </div>

      {/* Stats row */}
      <div className="flex items-center gap-4 text-xs text-muted-foreground">
        <span className="inline-flex items-center gap-1">
          <Users className="h-3.5 w-3.5" />
          {p.projectMembers.length} {p.projectMembers.length === 1 ? "membro" : "membros"}
        </span>
        <span className="inline-flex items-center gap-1">
          <ListChecks className="h-3.5 w-3.5" />
          {p.taskCount} {p.taskCount === 1 ? "task" : "tasks"}
        </span>
      </div>
    </Link>
  );
}

export function ProjectsView({ initial }: { initial: ProjectsViewInitial }) {
  const { member, effectiveAccessLevel } = useAuth();
  const meId = member?.id ?? null;
  // Guest enxerga só os projetos onde foi convidado (ProjectAccess via RLS
  // já filtra a query). Sem toggle "Meus / Todos" — é tudo "dele" por
  // definição. Também esconde botão "Novo Projeto".
  const isGuest = !hasMinAccessLevel(effectiveAccessLevel, "builder");
  const projectsCollection = useOptimisticCollection<Project>(initial.projects);
  const projects = projectsCollection.items;
  const setProjects = projectsCollection.setCommitted;
  const projectMutate = projectsCollection.mutate;
  const [open, setOpen] = useState(false);
  const [editProject, setEditProject] = useState<ProjectEditInitial | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [confirmState, setConfirmState] = useState<ConfirmState | null>(null);
  const [scope, setScope] = useState<"mine" | "all">("mine");

  const isMine = (p: Project) =>
    !!meId &&
    (p.pmId === meId || p.projectMembers.some((pm) => pm.member.id === meId));

  const visibleProjects = isGuest
    ? projects
    : scope === "mine" && meId
      ? projects.filter(isMine)
      : projects;
  const mineCount = meId ? projects.filter(isMine).length : 0;

  const reload = async () => {
    const supabase = createClient();

    const projectsRes = await supabase
      .from("Project")
      .select("*, client:Client(id, name), projectMembers:ProjectMember(id, member:Member(id, name, role, position)), pm:Member!pmId(id, name)")
      .order("createdAt", { ascending: false });

    if (projectsRes.data) {
      const { data: taskCounts } = await supabase
        .from("Task")
        .select("projectId")
        .neq("status", "draft")
        .is("dismissedAt", null);

      const countMap = new Map<string, number>();
      if (taskCounts) {
        for (const t of taskCounts) {
          countMap.set(t.projectId, (countMap.get(t.projectId) || 0) + 1);
        }
      }

      setProjects(
        projectsRes.data.map((p: Record<string, unknown>) => ({
          ...(p as unknown as Project),
          client: (p.client as Project["client"]) ?? { name: "" },
          pm: (p.pm as Project["pm"]) ?? null,
          projectMembers: (p.projectMembers as ProjectMemberAlloc[]) ?? [],
          taskCount: countMap.get(p.id as string) || 0,
        }))
      );
    }
  };

  const openNew = () => {
    setEditProject(null);
    setOpen(true);
  };

  const openEdit = (p: Project) => {
    setEditProject({
      id: p.id,
      name: p.name,
      repoUrl: p.repoUrl,
      startDate: p.startDate,
      endDate: p.endDate,
      status: p.status,
      category: p.category,
      phase: p.phase,
      engagementType: p.engagementType,
      clientId: p.clientId,
      pmId: p.pmId,
      githubRepoOwner: p.githubRepoOwner,
      githubRepoName: p.githubRepoName,
      githubDefaultBranch: p.githubDefaultBranch,
      memberIds: p.projectMembers.map((pm) => pm.member.id),
    });
    setOpen(true);
  };

  const remove = async (id: string) => {
    const project = projects.find((p) => p.id === id);
    if (!project) return;

    const supabase = createClient();
    const [tasksRes, storiesRes, sprintsRes, projTasksRes] = await Promise.all([
      supabase.from("Task").select("id", { count: "exact", head: true }).eq("projectId", id).is("dismissedAt", null),
      supabase.from("UserStory").select("id", { count: "exact", head: true }).eq("projectId", id),
      supabase.from("Sprint").select("id", { count: "exact", head: true }).eq("projectId", id),
      supabase.from("Task").select("id").eq("projectId", id).is("dismissedAt", null),
    ]);
    const counts = {
      tasks: tasksRes.count ?? 0,
      stories: storiesRes.count ?? 0,
      sprints: sprintsRes.count ?? 0,
      members: project.projectMembers.length,
      deps: 0,
    };
    if (projTasksRes.data && projTasksRes.data.length > 0) {
      const ids = projTasksRes.data.map((t) => t.id);
      const { count } = await supabase
        .from("TaskDependency")
        .select("taskId", { count: "exact", head: true })
        .or(`taskId.in.(${ids.join(",")}),dependsOn.in.(${ids.join(",")})`);
      counts.deps = count ?? 0;
    }

    const permanentItems = [
      counts.tasks > 0 ? `${counts.tasks} task${counts.tasks === 1 ? "" : "s"}` : null,
      counts.stories > 0 ? `${counts.stories} stor${counts.stories === 1 ? "y" : "ies"}` : null,
      counts.sprints > 0 ? `${counts.sprints} sprint${counts.sprints === 1 ? "" : "s"}` : null,
      counts.deps > 0 ? `${counts.deps} dependência${counts.deps === 1 ? "" : "s"} entre tasks` : null,
    ].filter(Boolean).join(", ");

    const sentences: string[] = [];
    if (permanentItems) sentences.push(`Vai apagar permanentemente: ${permanentItems}.`);
    if (counts.members > 0) {
      const verb = counts.members === 1 ? "será desvinculado" : "serão desvinculados";
      const noun = counts.members === 1 ? "membro" : "membros";
      sentences.push(`${counts.members} ${noun} ${verb} do projeto.`);
    }
    const description = sentences.length > 0 ? sentences.join(" ") : undefined;

    setConfirmState({
      title: `Excluir "${project.name}"?`,
      description,
      confirmLabel: "Excluir",
      destructive: true,
      onConfirm: async () => {
        const result = await projectMutate(
          { type: "delete", id },
          async () => {
            const sb = createClient();
            const { error } = await sb.rpc("delete_project_cascade", {
              p_project_id: id,
            });
            if (error) throw error;
            return { ok: true as const, id };
          },
          {
            errorLabel: "Falha ao remover projeto",
            reconcile: (prev) => prev.filter((p) => p.id !== id),
          },
        );
        if (result) {
          toast.success(`Projeto "${project.name}" excluído.`);
        }
      },
    });
  };

  const toggleExpand = (id: string) => {
    setExpandedId((prev) => (prev === id ? null : id));
  };

  return (
    <PageContainer>
      <div className="space-y-6">
        <PageHeader
          title="Projetos"
          onAdd={isGuest ? undefined : openNew}
          addLabel="Novo Projeto"
        />

      {!isGuest && (
        <div
          role="tablist"
          aria-label="Filtrar projetos"
          className="inline-flex rounded-md border bg-muted/40 p-0.5 text-sm"
        >
          {[
            { id: "mine" as const, label: "Meus projetos", count: mineCount },
            { id: "all" as const, label: "Todos", count: projects.length },
          ].map((opt) => {
            const active = scope === opt.id;
            const disabled = opt.id === "mine" && !meId;
            return (
              <button
                key={opt.id}
                role="tab"
                aria-selected={active}
                disabled={disabled}
                onClick={() => setScope(opt.id)}
                className={cn(
                  "rounded-sm px-3 py-1 transition-colors",
                  active
                    ? "bg-background shadow-sm text-foreground"
                    : "text-muted-foreground hover:text-foreground",
                  disabled && "cursor-not-allowed opacity-50 hover:text-muted-foreground",
                )}
              >
                {opt.label}
                <span className="ml-1.5 text-xs text-muted-foreground tabular-nums">
                  {opt.count}
                </span>
              </button>
            );
          })}
        </div>
      )}

      {/* Mobile: cards */}
      <div className="md:hidden space-y-3">
        {visibleProjects.map((p) => (
          <ProjectCardMobile
            key={p.id}
            p={p}
            onEdit={() => openEdit(p)}
            onDelete={() => remove(p.id)}
          />
        ))}
        {visibleProjects.length === 0 && (
          <div className="surface p-8 text-center text-muted-foreground text-sm">
            {isGuest
              ? "Você ainda não foi convidado a nenhum projeto."
              : scope === "mine"
                ? "Você não está alocado em nenhum projeto."
                : "Nenhum projeto cadastrado."}
          </div>
        )}
      </div>

      {/* Desktop: tabela */}
      <div className="surface hidden md:block">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-[40px]" />
              <TableHead>Nome</TableHead>
              <TableHead>Cliente</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Período</TableHead>
              <TableHead>Membros</TableHead>
              <TableHead>Tasks</TableHead>
              <TableHead className="w-[100px]" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {visibleProjects.map((p) => {
              const isExpanded = expandedId === p.id;
              return (
                <React.Fragment key={p.id}>
                  <TableRow className="cursor-pointer" onClick={() => toggleExpand(p.id)}>
                    <TableCell>
                      {p.projectMembers.length > 0 && (
                        isExpanded
                          ? <ChevronDown className="h-4 w-4 text-muted-foreground" />
                          : <ChevronRight className="h-4 w-4 text-muted-foreground" />
                      )}
                    </TableCell>
                    <TableCell className="font-medium">
                      <Link href={`/projects/${p.id}`} className="hover:underline" onClick={(e) => e.stopPropagation()}>
                        {p.name}
                      </Link>
                    </TableCell>
                    <TableCell>{p.client.name}</TableCell>
                    <TableCell>
                      <StatusChip {...lookupChip(PROJECT_STATUS, p.status)} dot />
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {p.startDate ? fmtDate(p.startDate) : "–"}
                      {" → "}
                      {p.endDate ? fmtDate(p.endDate) : "–"}
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1">
                        <Users className="h-3.5 w-3.5 text-muted-foreground" />
                        {p.projectMembers.length}
                      </div>
                    </TableCell>
                    <TableCell>{p.taskCount}</TableCell>
                    <TableCell>
                      <div className="flex gap-1" onClick={(e) => e.stopPropagation()}>
                        <Button variant="ghost" size="icon" onClick={() => openEdit(p)}>
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button variant="ghost" size="icon" onClick={() => remove(p.id)}>
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                  {isExpanded && p.projectMembers.length > 0 && (
                    <TableRow key={`${p.id}-detail`}>
                      <TableCell />
                      <TableCell colSpan={7}>
                        <div className="py-2">
                          <div className="flex flex-wrap gap-1.5">
                            {p.projectMembers.map((pm) => (
                              <Badge key={pm.id} variant="outline" className="text-xs">
                                {pm.member.name}
                                <span className="ml-1 text-muted-foreground">
                                  {roleLabel(pm.member.position)}
                                </span>
                              </Badge>
                            ))}
                          </div>
                        </div>
                      </TableCell>
                    </TableRow>
                  )}
                </React.Fragment>
              );
            })}
            {visibleProjects.length === 0 && (
              <TableRow>
                <TableCell colSpan={8} className="text-center text-muted-foreground py-8">
                  {scope === "mine"
                    ? "Você não está alocado em nenhum projeto."
                    : "Nenhum projeto cadastrado."}
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      <ProjectEditSheet
        open={open}
        onOpenChange={setOpen}
        project={editProject}
        onSaved={reload}
      />

      <ConfirmDialog state={confirmState} onClose={() => setConfirmState(null)} />
      </div>
    </PageContainer>
  );
}
