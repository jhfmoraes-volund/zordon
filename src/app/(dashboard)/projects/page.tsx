"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { PageHeader } from "@/components/page-header";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
import { roleLabel } from "@/lib/roles";
import { StatusChip } from "@/components/ui/status-chip";
import { StatusChipSelect } from "@/components/ui/status-chip-select";
import { PROJECT_STATUS, lookupChip } from "@/lib/status-chips";
import { useOptimisticCollection } from "@/hooks/use-optimistic-collection";
import { showErrorToast } from "@/lib/optimistic/toast";

type ProjectMemberAlloc = {
  id: string;
  member: { id: string; name: string; role: string };
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
type Member = { id: string; name: string; role: string };

function ProjectCardMobile({
  p,
  onEdit,
  onDelete,
}: {
  p: Project;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const fmtDate = (d: string | null) =>
    d ? new Date(d).toLocaleDateString("pt-BR", { day: "2-digit", month: "short" }) : "–";

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

export default function ProjectsPage() {
  const projectsCollection = useOptimisticCollection<Project>([]);
  const projects = projectsCollection.items;
  const setProjects = projectsCollection.setCommitted;
  const projectMutate = projectsCollection.mutate;
  const [clients, setClients] = useState<Client[]>([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Project | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
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
        .select("*, client:Client(id, name), projectMembers:ProjectMember(id, member:Member(id, name, role)), pm:Member!pmId(id, name)")
        .order("createdAt", { ascending: false }),
      supabase.from("Client").select("id, name").order("name"),
      supabase.from("Member").select("id, name, role").order("name"),
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
      const { data } = await supabase.from("Project").insert({ id: crypto.randomUUID(), updatedAt: new Date().toISOString(), ...projectData }).select("id").single();
      if (!data) return;
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
    if (!confirm("Remover este projeto?")) return;
    await projectMutate(
      { type: "delete", id },
      async () => {
        const supabase = createClient();
        const { error } = await supabase.from("Project").delete().eq("id", id);
        if (error) throw new Error(error.message);
        return { ok: true as const, id };
      },
      {
        errorLabel: "Falha ao remover projeto",
        reconcile: (prev) => prev.filter((p) => p.id !== id),
      },
    );
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
      <PageHeader title="Projetos" onAdd={openNew} addLabel="Novo Projeto" />

      {/* Mobile: cards */}
      <div className="md:hidden space-y-3">
        {projects.map((p) => (
          <ProjectCardMobile
            key={p.id}
            p={p}
            onEdit={() => openEdit(p)}
            onDelete={() => remove(p.id)}
          />
        ))}
        {projects.length === 0 && (
          <div className="surface p-8 text-center text-muted-foreground text-sm">
            Nenhum projeto cadastrado.
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
            {projects.map((p) => {
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
                                  {roleLabel(pm.member.role)}
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
            {projects.length === 0 && (
              <TableRow>
                <TableCell colSpan={8} className="text-center text-muted-foreground py-8">
                  Nenhum projeto cadastrado.
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
          <ResponsiveDialogBody className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label>Cliente</Label>
              <Select value={form.clientId} onValueChange={(v) => v && setForm({ ...form, clientId: v })}>
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
              <Select value={form.pmId} onValueChange={(v) => v && setForm({ ...form, pmId: v })}>
                <SelectTrigger>
                  <SelectValue placeholder="Selecione (opcional)">
                    {(value: string | null) => members.find((m) => m.id === value)?.name ?? "Selecione (opcional)"}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {members
                    .filter((m) => m.role === "pm")
                    .map((m) => (
                      <SelectItem key={m.id} value={m.id}>{m.name}</SelectItem>
                    ))}
                  {members.filter((m) => m.role === "pm").length === 0 && (
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
                {members
                  .filter((m) => m.role !== "pm")
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
                          {roleLabel(m.role)}
                        </span>
                      </Badge>
                    );
                  })}
                {members.filter((m) => m.role !== "pm").length === 0 && (
                  <span className="text-xs text-muted-foreground">Nenhum membro cadastrado</span>
                )}
              </div>
            </div>
            <div className="grid gap-2">
              <Label>Nome</Label>
              <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            </div>
            <div className="grid gap-2">
              <Label>Repo URL</Label>
              <Input value={form.repoUrl} onChange={(e) => setForm({ ...form, repoUrl: e.target.value })} placeholder="https://github.com/..." />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div className="grid gap-2">
                <Label>GitHub Owner</Label>
                <Input value={form.githubRepoOwner} onChange={(e) => setForm({ ...form, githubRepoOwner: e.target.value })} placeholder="org-name" />
              </div>
              <div className="grid gap-2">
                <Label>GitHub Repo</Label>
                <Input value={form.githubRepoName} onChange={(e) => setForm({ ...form, githubRepoName: e.target.value })} placeholder="repo-name" />
              </div>
              <div className="grid gap-2">
                <Label>Default Branch</Label>
                <Input value={form.githubDefaultBranch} onChange={(e) => setForm({ ...form, githubDefaultBranch: e.target.value })} placeholder="main" />
              </div>
            </div>
            <div className="grid gap-2">
              <label className="flex items-center gap-2 text-sm cursor-pointer select-none">
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
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="grid gap-2">
                    <Label>Data Início</Label>
                    <Input type="date" value={form.startDate} onChange={(e) => setForm({ ...form, startDate: e.target.value })} />
                  </div>
                  <div className="grid gap-2">
                    <Label>Data Fim</Label>
                    <Input type="date" value={form.endDate} onChange={(e) => setForm({ ...form, endDate: e.target.value })} />
                  </div>
                </div>
              )}
            </div>
<div className="grid gap-2">
              <Label>Status</Label>
              <StatusChipSelect
                variant="input"
                value={form.status}
                options={PROJECT_STATUS}
                onValueChange={(v) => setForm({ ...form, status: v })}
              />
            </div>
          </ResponsiveDialogBody>
          <ResponsiveDialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Cancelar</Button>
            <Button onClick={save} disabled={!form.name || !form.clientId}>Salvar</Button>
          </ResponsiveDialogFooter>
        </ResponsiveDialogContent>
      </ResponsiveDialog>
    </div>
  );
}
