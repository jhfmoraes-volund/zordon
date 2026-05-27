"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { PageHeader } from "@/components/page-header";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Field, FormBody } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
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
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Pencil, Trash2, Users, ChevronDown, ChevronRight, MoreVertical, ListChecks } from "lucide-react";
import { hasMinAccessLevel, roleLabel } from "@/lib/roles";
import { StatusChip } from "@/components/ui/status-chip";
import { StatusChipSelect } from "@/components/ui/status-chip-select";
import { PROJECT_STATUS, lookupChip } from "@/lib/status-chips";
import { useOptimisticCollection } from "@/hooks/use-optimistic-collection";
import { showErrorToast } from "@/lib/optimistic/toast";
import { generateUniqueReferenceKey } from "@/lib/project-reference-key";
import { fmtDate } from "@/lib/date-utils";
import { ConfirmDialog, type ConfirmState } from "@/components/ui/confirm-dialog";
import { toast } from "sonner";
import { useAuth } from "@/contexts/auth-context";
import { cn } from "@/lib/utils";

type ProjectMemberAlloc = {
  id: string;
  member: { id: string; name: string; role: string; position: string | null };
};

type Project = {
  id: string;
  name: string;
  repoUrl: string | null;
  startDate: string | null;
  endDate: string | null;
  status: string;
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

type Client = { id: string; name: string };
type Member = { id: string; name: string; role: string; position: string | null };

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
            // eslint-disable-next-line no-restricted-syntax -- icon button in row action, not a form control
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

export default function ProjectsPage() {
  const { member, effectiveAccessLevel } = useAuth();
  const meId = member?.id ?? null;
  // Guest enxerga só os projetos onde foi convidado (ProjectAccess via RLS
  // já filtra a query). Sem toggle "Meus / Todos" — é tudo "dele" por
  // definição. Também esconde botão "Novo Projeto".
  const isGuest = !hasMinAccessLevel(effectiveAccessLevel, "builder");
  const projectsCollection = useOptimisticCollection<Project>([]);
  const projects = projectsCollection.items;
  const setProjects = projectsCollection.setCommitted;
  const projectMutate = projectsCollection.mutate;
  const [clients, setClients] = useState<Client[]>([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Project | null>(null);
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
  const [form, setForm] = useState({
    name: "", repoUrl: "", startDate: "", endDate: "",    status: "active", clientId: "", pmId: "",
    githubRepoOwner: "", githubRepoName: "", githubDefaultBranch: "main",
    memberIds: [] as string[],
    ongoing: false,
  });

  const load = async () => {
    const supabase = createClient();

    const [projectsRes, clientsRes, membersRes] = await Promise.all([
      supabase
        .from("Project")
        .select("*, client:Client(id, name), projectMembers:ProjectMember(id, member:Member(id, name, role, position)), pm:Member!pmId(id, name)")
        .order("createdAt", { ascending: false }),
      supabase.from("Client").select("id, name").order("name"),
      supabase.from("Member").select("id, name, role, position").eq("isGuest", false).order("name"),
    ]);

    if (projectsRes.data) {
      // Get task counts per project
      const { data: taskCounts } = await supabase
        .from("Task")
        .select("projectId")
        .neq("status", "draft");

      const countMap = new Map<string, number>();
      if (taskCounts) {
        for (const t of taskCounts) {
          countMap.set(t.projectId, (countMap.get(t.projectId) || 0) + 1);
        }
      }

      setProjects(
        projectsRes.data.map((p: any) => ({
          ...p,
          client: p.client ?? { name: "" },
          pm: p.pm ?? null,
          projectMembers: p.projectMembers ?? [],
          taskCount: countMap.get(p.id) || 0,
        }))
      );
    }
    if (clientsRes.data) setClients(clientsRes.data);
    if (membersRes.data) setMembers(membersRes.data);
  };

  useEffect(() => { load(); }, []);

  const openNew = () => {
    setEditing(null);
    setForm({
      name: "", repoUrl: "", startDate: "", endDate: "",      status: "active", clientId: "", pmId: "",
      githubRepoOwner: "", githubRepoName: "", githubDefaultBranch: "main",
      memberIds: [],
      ongoing: false,
    });
    setOpen(true);
  };

  const openEdit = (p: Project) => {
    setEditing(p);
    setForm({
      name: p.name,
      repoUrl: p.repoUrl || "",
      startDate: p.startDate ? p.startDate.slice(0, 10) : "",
      endDate: p.endDate ? p.endDate.slice(0, 10) : "",

      status: p.status,
      clientId: p.clientId,
      pmId: p.pmId || "",
      githubRepoOwner: p.githubRepoOwner || "",
      githubRepoName: p.githubRepoName || "",
      githubDefaultBranch: p.githubDefaultBranch || "main",
      memberIds: p.projectMembers.map((pm) => pm.member.id),
      ongoing: !p.startDate && !p.endDate,
    });
    setOpen(true);
  };

  const save = async () => {
    const supabase = createClient();
    const projectData = {
      name: form.name,
      repoUrl: form.repoUrl || null,
      startDate: form.ongoing || !form.startDate ? null : new Date(form.startDate).toISOString(),
      endDate: form.ongoing || !form.endDate ? null : new Date(form.endDate).toISOString(),
      status: form.status,
      clientId: form.clientId,
      pmId: form.pmId || null,
      githubRepoOwner: form.githubRepoOwner || null,
      githubRepoName: form.githubRepoName || null,
      githubDefaultBranch: form.githubDefaultBranch || "main",
    };

    let projectId: string;

    if (editing) {
      await supabase.from("Project").update(projectData).eq("id", editing.id);
      projectId = editing.id;
    } else {
      const referenceKey = await generateUniqueReferenceKey(supabase, form.name);
      const { data, error } = await supabase
        .from("Project")
        .insert({
          id: crypto.randomUUID(),
          updatedAt: new Date().toISOString(),
          referenceKey,
          ...projectData,
        })
        .select("id")
        .single();
      if (error || !data) {
        showErrorToast(new Error(error?.message ?? "Falha ao criar projeto"), {
          label: "Projeto",
        });
        return;
      }
      projectId = data.id;
    }

    // Sync project members
    await supabase.from("ProjectMember").delete().eq("projectId", projectId);
    if (form.memberIds.length > 0) {
      await supabase.from("ProjectMember").insert(
        form.memberIds.map((memberId) => ({ id: crypto.randomUUID(), projectId, memberId }))
      );
    }

    setOpen(false);
    load();
  };

  const remove = async (id: string) => {
    const project = projects.find((p) => p.id === id);
    if (!project) return;

    const supabase = createClient();
    const [tasksRes, storiesRes, sprintsRes, projTasksRes] = await Promise.all([
      supabase.from("Task").select("id", { count: "exact", head: true }).eq("projectId", id),
      supabase.from("UserStory").select("id", { count: "exact", head: true }).eq("projectId", id),
      supabase.from("Sprint").select("id", { count: "exact", head: true }).eq("projectId", id),
      supabase.from("Task").select("id").eq("projectId", id),
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

  const toggleMember = (memberId: string) => {
    setForm((f) => ({
      ...f,
      memberIds: f.memberIds.includes(memberId)
        ? f.memberIds.filter((id) => id !== memberId)
        : [...f.memberIds, memberId],
    }));
  };

  return (
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
                      {p.startDate ? new Date(p.startDate).toLocaleDateString("pt-BR", { day: "2-digit", month: "short" }) : "–"}
                      {" → "}
                      {p.endDate ? new Date(p.endDate).toLocaleDateString("pt-BR", { day: "2-digit", month: "short" }) : "–"}
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

      <ResponsiveDialog open={open} onOpenChange={setOpen}>
        <ResponsiveDialogContent>
          <ResponsiveDialogHeader>
            <ResponsiveDialogTitle>{editing ? "Editar Projeto" : "Novo Projeto"}</ResponsiveDialogTitle>
          </ResponsiveDialogHeader>
          <ResponsiveDialogBody className="py-4">
            <FormBody>
              <Field name="project-client" required>
                <Field.Label>Cliente</Field.Label>
                <Field.Control>
                  <Select
                    value={form.clientId}
                    onValueChange={(v) => v && setForm({ ...form, clientId: v })}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Selecione">
                        {(value: string | null) =>
                          clients.find((c) => c.id === value)?.name ??
                          "Selecione"
                        }
                      </SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      {clients.map((c) => (
                        <SelectItem key={c.id} value={c.id}>
                          {c.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field.Control>
              </Field>

              <Field name="project-pm">
                <Field.Label>PM Responsável</Field.Label>
                <Field.Control>
                  <Select
                    value={form.pmId}
                    onValueChange={(v) => v && setForm({ ...form, pmId: v })}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Selecione (opcional)">
                        {(value: string | null) =>
                          members.find((m) => m.id === value)?.name ??
                          "Selecione (opcional)"
                        }
                      </SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      {members
                        .filter((m) => m.position === "pm")
                        .map((m) => (
                          <SelectItem key={m.id} value={m.id}>
                            {m.name}
                          </SelectItem>
                        ))}
                      {members.filter((m) => m.position === "pm").length ===
                        0 && (
                        <div className="px-2 py-1.5 text-xs text-muted-foreground">
                          Nenhum membro com role &quot;pm&quot; cadastrado
                        </div>
                      )}
                    </SelectContent>
                  </Select>
                </Field.Control>
              </Field>

              <Field name="project-members">
                <Field.Label>Membros Alocados</Field.Label>
                <Field.Hint>
                  Clique para alocar/desalocar membros do projeto
                </Field.Hint>
                <div className="flex min-h-[40px] flex-wrap gap-1.5 rounded-md border p-3">
                  {members
                    .filter((m) => m.position !== "pm")
                    .map((m) => {
                      const isSelected = form.memberIds.includes(m.id);
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
                            {roleLabel(m.position)}
                          </span>
                        </Badge>
                      );
                    })}
                  {members.filter((m) => m.position !== "pm").length === 0 && (
                    <span className="text-xs text-muted-foreground">
                      Nenhum membro cadastrado
                    </span>
                  )}
                </div>
              </Field>

              <Field name="project-name" required>
                <Field.Label>Nome</Field.Label>
                <Field.Control>
                  <Input
                    value={form.name}
                    onChange={(e) => setForm({ ...form, name: e.target.value })}
                  />
                </Field.Control>
              </Field>

              <Field name="project-repo">
                <Field.Label>Repo URL</Field.Label>
                <Field.Control>
                  <Input
                    value={form.repoUrl}
                    onChange={(e) =>
                      setForm({ ...form, repoUrl: e.target.value })
                    }
                    placeholder="https://github.com/..."
                  />
                </Field.Control>
              </Field>

              <Field.Row cols={3}>
                <Field name="project-gh-owner">
                  <Field.Label>GitHub Owner</Field.Label>
                  <Field.Control>
                    <Input
                      value={form.githubRepoOwner}
                      onChange={(e) =>
                        setForm({ ...form, githubRepoOwner: e.target.value })
                      }
                      placeholder="org-name"
                    />
                  </Field.Control>
                </Field>
                <Field name="project-gh-repo">
                  <Field.Label>GitHub Repo</Field.Label>
                  <Field.Control>
                    <Input
                      value={form.githubRepoName}
                      onChange={(e) =>
                        setForm({ ...form, githubRepoName: e.target.value })
                      }
                      placeholder="repo-name"
                    />
                  </Field.Control>
                </Field>
                <Field name="project-gh-branch">
                  <Field.Label>Default Branch</Field.Label>
                  <Field.Control>
                    <Input
                      value={form.githubDefaultBranch}
                      onChange={(e) =>
                        setForm({
                          ...form,
                          githubDefaultBranch: e.target.value,
                        })
                      }
                      placeholder="main"
                    />
                  </Field.Control>
                </Field>
              </Field.Row>

              <div className="flex flex-col gap-(--field-gap)">
                <label className="flex cursor-pointer items-center gap-2 text-sm select-none">
                  <input
                    type="checkbox"
                    className="h-4 w-4 rounded border-input"
                    checked={form.ongoing}
                    onChange={(e) =>
                      setForm({
                        ...form,
                        ongoing: e.target.checked,
                        startDate: e.target.checked ? "" : form.startDate,
                        endDate: e.target.checked ? "" : form.endDate,
                      })
                    }
                  />
                  Projeto em andamento (sem prazo definido)
                </label>
                {!form.ongoing && (
                  <Field.Row cols={2}>
                    <Field name="project-start">
                      <Field.Label>Data Início</Field.Label>
                      <Field.Control>
                        <Input
                          type="date"
                          value={form.startDate}
                          onChange={(e) =>
                            setForm({ ...form, startDate: e.target.value })
                          }
                        />
                      </Field.Control>
                    </Field>
                    <Field name="project-end">
                      <Field.Label>Data Fim</Field.Label>
                      <Field.Control>
                        <Input
                          type="date"
                          value={form.endDate}
                          onChange={(e) =>
                            setForm({ ...form, endDate: e.target.value })
                          }
                        />
                      </Field.Control>
                    </Field>
                  </Field.Row>
                )}
              </div>

              <Field name="project-status">
                <Field.Label>Status</Field.Label>
                <Field.Control>
                  <StatusChipSelect
                    variant="input"
                    value={form.status}
                    options={PROJECT_STATUS}
                    onValueChange={(v) => setForm({ ...form, status: v })}
                  />
                </Field.Control>
              </Field>
            </FormBody>
          </ResponsiveDialogBody>
          <ResponsiveDialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Cancelar</Button>
            <Button onClick={save} disabled={!form.name || !form.clientId}>Salvar</Button>
          </ResponsiveDialogFooter>
        </ResponsiveDialogContent>
      </ResponsiveDialog>

      <ConfirmDialog state={confirmState} onClose={() => setConfirmState(null)} />
    </div>
  );
}
