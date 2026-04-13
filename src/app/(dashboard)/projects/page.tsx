"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import { PageHeader } from "@/components/page-header";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
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
import { Pencil, Trash2, Users, ChevronDown, ChevronRight } from "lucide-react";

type SquadMember = {
  id: string;
  member: { id: string; name: string; role: string };
};

type ProjectSquad = {
  id: string;
  squad: {
    id: string;
    name: string;
    members: SquadMember[];
  };
};

type Project = {
  id: string;
  name: string;
  repoUrl: string | null;
  startDate: string | null;
  endDate: string | null;
  contractUrl: string | null;
  status: string;
  clientId: string;
  githubRepoOwner: string | null;
  githubRepoName: string | null;
  githubDefaultBranch: string;
  pmId: string | null;
  client: { name: string };
  pm: { id: string; name: string } | null;
  projectSquads: ProjectSquad[];
  _count: { tasks: number };
};

type Client = { id: string; name: string };
type Member = { id: string; name: string; role: string };

const statusColors: Record<string, string> = {
  active: "bg-green-100 text-green-800",
  paused: "bg-yellow-100 text-yellow-800",
  completed: "bg-blue-100 text-blue-800",
  archived: "bg-gray-100 text-gray-800",
};

const roleLabels: Record<string, string> = {
  "ui-ux-builder": "UI/UX",
  "backend-qa-builder": "Backend/QA",
  fullstack: "Fullstack",
};

export default function ProjectsPage() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [clients, setClients] = useState<Client[]>([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Project | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [form, setForm] = useState({
    name: "", repoUrl: "", startDate: "", endDate: "", contractUrl: "",
    status: "active", clientId: "", pmId: "",
    githubRepoOwner: "", githubRepoName: "", githubDefaultBranch: "main",
  });

  const load = () => {
    fetch("/api/projects").then((r) => r.json()).then(setProjects);
    fetch("/api/clients").then((r) => r.json()).then(setClients);
    fetch("/api/members").then((r) => r.json()).then(setMembers);
  };

  useEffect(() => { load(); }, []);

  const openNew = () => {
    setEditing(null);
    setForm({
      name: "", repoUrl: "", startDate: "", endDate: "", contractUrl: "",
      status: "active", clientId: "", pmId: "",
      githubRepoOwner: "", githubRepoName: "", githubDefaultBranch: "main",
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
      contractUrl: p.contractUrl || "",
      status: p.status,
      clientId: p.clientId,
      pmId: p.pmId || "",
      githubRepoOwner: p.githubRepoOwner || "",
      githubRepoName: p.githubRepoName || "",
      githubDefaultBranch: p.githubDefaultBranch || "main",
    });
    setOpen(true);
  };

  const save = async () => {
    const body = {
      name: form.name,
      repoUrl: form.repoUrl || null,
      startDate: form.startDate ? new Date(form.startDate).toISOString() : null,
      endDate: form.endDate ? new Date(form.endDate).toISOString() : null,
      contractUrl: form.contractUrl || null,
      status: form.status,
      clientId: form.clientId,
      pmId: form.pmId || null,
      githubRepoOwner: form.githubRepoOwner || null,
      githubRepoName: form.githubRepoName || null,
      githubDefaultBranch: form.githubDefaultBranch || "main",
    };
    if (editing) {
      await fetch(`/api/projects/${editing.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
    } else {
      await fetch("/api/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
    }
    setOpen(false);
    load();
  };

  const remove = async (id: string) => {
    if (!confirm("Remover este projeto?")) return;
    await fetch(`/api/projects/${id}`, { method: "DELETE" });
    load();
  };

  const toggleExpand = (id: string) => {
    setExpandedId((prev) => (prev === id ? null : id));
  };

  // Collect unique members across all squads for a project
  const getProjectMembers = (p: Project) => {
    const seen = new Set<string>();
    const members: { id: string; name: string; role: string; squadName: string }[] = [];
    for (const ps of p.projectSquads) {
      for (const sm of ps.squad.members) {
        if (!seen.has(sm.member.id)) {
          seen.add(sm.member.id);
          members.push({ ...sm.member, squadName: ps.squad.name });
        }
      }
    }
    return members;
  };

  return (
    <div className="space-y-6">
      <PageHeader title="Projetos" onAdd={openNew} addLabel="Novo Projeto" />

      <div className="surface">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-[40px]" />
              <TableHead>Nome</TableHead>
              <TableHead>Cliente</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Período</TableHead>
              <TableHead>Squads</TableHead>
              <TableHead>Membros</TableHead>
              <TableHead>Tasks</TableHead>
              <TableHead className="w-[100px]" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {projects.map((p) => {
              const members = getProjectMembers(p);
              const isExpanded = expandedId === p.id;
              return (
                <React.Fragment key={p.id}>
                  <TableRow className="cursor-pointer" onClick={() => toggleExpand(p.id)}>
                    <TableCell>
                      {p.projectSquads.length > 0 && (
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
                      <Badge variant="secondary" className={statusColors[p.status]}>
                        {p.status}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {p.startDate ? new Date(p.startDate).toLocaleDateString("pt-BR", { day: "2-digit", month: "short" }) : "–"}
                      {" → "}
                      {p.endDate ? new Date(p.endDate).toLocaleDateString("pt-BR", { day: "2-digit", month: "short" }) : "–"}
                    </TableCell>
                    <TableCell>{p.projectSquads.length}</TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1">
                        <Users className="h-3.5 w-3.5 text-muted-foreground" />
                        {members.length}
                      </div>
                    </TableCell>
                    <TableCell>{p._count.tasks}</TableCell>
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
                  {isExpanded && p.projectSquads.length > 0 && (
                    <TableRow key={`${p.id}-detail`}>
                      <TableCell />
                      <TableCell colSpan={8}>
                        <div className="py-2 space-y-3">
                          {p.projectSquads.map((ps) => (
                            <div key={ps.id} className="space-y-1">
                              <p className="text-sm font-medium">{ps.squad.name}</p>
                              <div className="flex flex-wrap gap-1.5 pl-2">
                                {ps.squad.members.map((sm) => (
                                  <Badge key={sm.id} variant="outline" className="text-xs">
                                    {sm.member.name}
                                    <span className="ml-1 text-muted-foreground">
                                      {roleLabels[sm.member.role] || sm.member.role}
                                    </span>
                                  </Badge>
                                ))}
                                {ps.squad.members.length === 0 && (
                                  <span className="text-xs text-muted-foreground">Sem membros</span>
                                )}
                              </div>
                            </div>
                          ))}
                        </div>
                      </TableCell>
                    </TableRow>
                  )}
                </React.Fragment>
              );
            })}
            {projects.length === 0 && (
              <TableRow>
                <TableCell colSpan={9} className="text-center text-muted-foreground py-8">
                  Nenhum projeto cadastrado.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editing ? "Editar Projeto" : "Novo Projeto"}</DialogTitle>
          </DialogHeader>
          <div className="grid gap-4 py-4">
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
              <Label>Nome</Label>
              <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            </div>
            <div className="grid gap-2">
              <Label>Repo URL</Label>
              <Input value={form.repoUrl} onChange={(e) => setForm({ ...form, repoUrl: e.target.value })} placeholder="https://github.com/..." />
            </div>
            <div className="grid grid-cols-3 gap-4">
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
            <div className="grid grid-cols-2 gap-4">
              <div className="grid gap-2">
                <Label>Data Início</Label>
                <Input type="date" value={form.startDate} onChange={(e) => setForm({ ...form, startDate: e.target.value })} />
              </div>
              <div className="grid gap-2">
                <Label>Data Fim</Label>
                <Input type="date" value={form.endDate} onChange={(e) => setForm({ ...form, endDate: e.target.value })} />
              </div>
            </div>
            <div className="grid gap-2">
              <Label>Link do Contrato</Label>
              <Input value={form.contractUrl} onChange={(e) => setForm({ ...form, contractUrl: e.target.value })} placeholder="https://..." />
            </div>
            <div className="grid gap-2">
              <Label>Status</Label>
              <Select value={form.status} onValueChange={(v) => v && setForm({ ...form, status: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="active">Active</SelectItem>
                  <SelectItem value="paused">Paused</SelectItem>
                  <SelectItem value="completed">Completed</SelectItem>
                  <SelectItem value="archived">Archived</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setOpen(false)}>Cancelar</Button>
            <Button onClick={save} disabled={!form.name || !form.clientId}>Salvar</Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
