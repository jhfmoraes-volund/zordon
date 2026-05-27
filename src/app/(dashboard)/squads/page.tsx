"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
import { Pencil, Trash2, UserPlus, FolderOpen } from "lucide-react";

type Squad = {
  id: string;
  name: string;
  projectSquads: { id: string; project: { id: string; name: string } }[];
  members: { id: string; member: { id: string; name: string; role: string; position: string | null } }[];
};

type Project = { id: string; name: string };
type Member = { id: string; name: string; role: string; position: string | null };

/** Map Supabase row shape (PascalCase join tables) to the Squad type used by the UI. */
function mapSquadRow(row: Record<string, unknown>): Squad {
  const projectSquads = (
    (row.ProjectSquad as Array<Record<string, unknown>> | undefined) ?? []
  ).map((ps) => ({
    id: ps.id as string,
    project: ps.project as { id: string; name: string },
  }));

  const members = (
    (row.SquadMember as Array<Record<string, unknown>> | undefined) ?? []
  ).map((sm) => ({
    id: sm.id as string,
    member: sm.member as { id: string; name: string; role: string; position: string | null },
  }));

  return {
    id: row.id as string,
    name: row.name as string,
    projectSquads,
    members,
  };
}

export default function SquadsPage() {
  const [squads, setSquads] = useState<Squad[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [allMembers, setAllMembers] = useState<Member[]>([]);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Squad | null>(null);
  const [form, setForm] = useState({
    name: "", projectIds: [] as string[], memberIds: [] as string[],
  });

  const load = async () => {
    const supabase = createClient();

    const [squadsRes, projectsRes, membersRes] = await Promise.all([
      supabase
        .from("Squad")
        .select(
          "*, SquadMember(*, member:Member(*)), ProjectSquad(*, project:Project(id, name))",
        )
        .order("name"),
      supabase.from("Project").select("id, name").order("name"),
      supabase.from("Member").select("id, name, role, position").eq("isGuest", false).order("name"),
    ]);

    if (squadsRes.data) setSquads(squadsRes.data.map(mapSquadRow));
    if (projectsRes.data) setProjects(projectsRes.data as Project[]);
    if (membersRes.data) setAllMembers(membersRes.data as Member[]);
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
    const supabase = createClient();

    if (editing) {
      // Update squad name
      await supabase
        .from("Squad")
        .update({ name: form.name })
        .eq("id", editing.id);

      // Remove existing relations then re-insert
      await Promise.all([
        supabase.from("SquadMember").delete().eq("squadId", editing.id),
        supabase.from("ProjectSquad").delete().eq("squadId", editing.id),
      ]);

      const memberRows = form.memberIds.map((memberId) => ({
        id: crypto.randomUUID(),
        squadId: editing.id,
        memberId,
      }));
      const projectRows = form.projectIds.map((projectId) => ({
        id: crypto.randomUUID(),
        projectId,
        squadId: editing.id,
      }));

      await Promise.all([
        memberRows.length > 0
          ? supabase.from("SquadMember").insert(memberRows)
          : Promise.resolve(),
        projectRows.length > 0
          ? supabase.from("ProjectSquad").insert(projectRows)
          : Promise.resolve(),
      ]);
    } else {
      // Create new squad
      const squadId = crypto.randomUUID();
      await supabase
        .from("Squad")
        .insert({ id: squadId, name: form.name, updatedAt: new Date().toISOString() });

      const memberRows = form.memberIds.map((memberId) => ({
        id: crypto.randomUUID(),
        squadId,
        memberId,
      }));
      const projectRows = form.projectIds.map((projectId) => ({
        id: crypto.randomUUID(),
        projectId,
        squadId,
      }));

      await Promise.all([
        memberRows.length > 0
          ? supabase.from("SquadMember").insert(memberRows)
          : Promise.resolve(),
        projectRows.length > 0
          ? supabase.from("ProjectSquad").insert(projectRows)
          : Promise.resolve(),
      ]);
    }

    setOpen(false);
    load();
  };

  const remove = async (id: string) => {
    if (!confirm("Remover este squad?")) return;
    await createClient().from("Squad").delete().eq("id", id);
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

      <ResponsiveDialog open={open} onOpenChange={setOpen}>
        <ResponsiveDialogContent>
          <ResponsiveDialogHeader>
            <ResponsiveDialogTitle>{editing ? "Editar Squad" : "Novo Squad"}</ResponsiveDialogTitle>
          </ResponsiveDialogHeader>
          <ResponsiveDialogBody className="grid gap-4 py-4">
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
          </ResponsiveDialogBody>
          <ResponsiveDialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Cancelar</Button>
            <Button onClick={save} disabled={!form.name}>Salvar</Button>
          </ResponsiveDialogFooter>
        </ResponsiveDialogContent>
      </ResponsiveDialog>
    </div>
  );
}
