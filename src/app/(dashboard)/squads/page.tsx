"use client";

import { useEffect, useState } from "react";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Pencil, Trash2, UserPlus, FolderOpen } from "lucide-react";

type Squad = {
  id: string;
  name: string;
  projectSquads: { id: string; project: { id: string; name: string } }[];
  members: { id: string; member: { id: string; name: string; role: string } }[];
};

type Project = { id: string; name: string };
type Member = { id: string; name: string; role: string };

export default function SquadsPage() {
  const [squads, setSquads] = useState<Squad[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [allMembers, setAllMembers] = useState<Member[]>([]);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Squad | null>(null);
  const [form, setForm] = useState({
    name: "", projectIds: [] as string[], memberIds: [] as string[],
  });

  const load = () => {
    fetch("/api/squads").then((r) => r.json()).then(setSquads);
    fetch("/api/projects").then((r) => r.json()).then(setProjects);
    fetch("/api/members").then((r) => r.json()).then(setAllMembers);
  };

  useEffect(() => { load(); }, []);

  const openNew = () => {
    setEditing(null);
    setForm({ name: "", projectIds: [], memberIds: [] });
    setOpen(true);
  };

  const openEdit = (s: Squad) => {
    setEditing(s);
    setForm({
      name: s.name,
      projectIds: s.projectSquads.map((ps) => ps.project.id),
      memberIds: s.members.map((m) => m.member.id),
    });
    setOpen(true);
  };

  const toggleProject = (projectId: string) => {
    setForm((f) => ({
      ...f,
      projectIds: f.projectIds.includes(projectId)
        ? f.projectIds.filter((id) => id !== projectId)
        : [...f.projectIds, projectId],
    }));
  };

  const toggleMember = (memberId: string) => {
    setForm((f) => ({
      ...f,
      memberIds: f.memberIds.includes(memberId)
        ? f.memberIds.filter((id) => id !== memberId)
        : [...f.memberIds, memberId],
    }));
  };

  const save = async () => {
    const body = {
      name: form.name,
      projectIds: form.projectIds,
      memberIds: form.memberIds,
    };
    if (editing) {
      await fetch(`/api/squads/${editing.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
    } else {
      await fetch("/api/squads", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
    }
    setOpen(false);
    load();
  };

  const remove = async (id: string) => {
    if (!confirm("Remover este squad?")) return;
    await fetch(`/api/squads/${id}`, { method: "DELETE" });
    load();
  };

  return (
    <div className="space-y-6">
      <PageHeader title="Squads" onAdd={openNew} addLabel="Novo Squad" />

      <div className="grid gap-4 md:grid-cols-2">
        {squads.map((s) => (
          <Card key={s.id}>
            <CardHeader className="flex flex-row items-start justify-between pb-2">
              <div>
                <CardTitle className="text-base">{s.name}</CardTitle>
                <div className="flex flex-wrap gap-1 mt-1">
                  {s.projectSquads.map((ps) => (
                    <Badge key={ps.id} variant="secondary" className="text-xs">
                      <FolderOpen className="mr-1 h-3 w-3" />
                      {ps.project.name}
                    </Badge>
                  ))}
                  {s.projectSquads.length === 0 && (
                    <span className="text-xs text-muted-foreground">Sem projetos</span>
                  )}
                </div>
              </div>
              <div className="flex gap-1">
                <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => openEdit(s)}>
                  <Pencil className="h-3.5 w-3.5" />
                </Button>
                <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => remove(s.id)}>
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              <div className="flex flex-wrap gap-2">
                {s.members.map((sm) => (
                  <Badge key={sm.id} variant="outline">
                    {sm.member.name}
                  </Badge>
                ))}
                {s.members.length === 0 && (
                  <p className="text-sm text-muted-foreground">Sem membros</p>
                )}
              </div>
            </CardContent>
          </Card>
        ))}
        {squads.length === 0 && (
          <p className="text-muted-foreground col-span-2 text-center py-8">
            Nenhum squad cadastrado.
          </p>
        )}
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editing ? "Editar Squad" : "Novo Squad"}</DialogTitle>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label>Nome</Label>
              <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            </div>
            <div className="grid gap-2">
              <Label>Projetos</Label>
              <div className="flex flex-wrap gap-2 surface-inset p-3 min-h-[44px]">
                {projects.map((p) => (
                  <Badge
                    key={p.id}
                    variant={form.projectIds.includes(p.id) ? "default" : "outline"}
                    className="cursor-pointer"
                    onClick={() => toggleProject(p.id)}
                  >
                    <FolderOpen className="mr-1 h-3 w-3" />
                    {p.name}
                  </Badge>
                ))}
              </div>
            </div>
            <div className="grid gap-2">
              <Label>Membros</Label>
              <div className="flex flex-wrap gap-2 surface-inset p-3 min-h-[44px]">
                {allMembers.map((m) => (
                  <Badge
                    key={m.id}
                    variant={form.memberIds.includes(m.id) ? "default" : "outline"}
                    className="cursor-pointer"
                    onClick={() => toggleMember(m.id)}
                  >
                    <UserPlus className="mr-1 h-3 w-3" />
                    {m.name}
                  </Badge>
                ))}
              </div>
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
