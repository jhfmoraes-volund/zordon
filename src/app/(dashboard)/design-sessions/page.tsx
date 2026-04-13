"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Play, Trash2, FileText } from "lucide-react";

type Session = {
  id: string;
  title: string;
  type: string;
  status: string;
  currentStep: number;
  totalSteps: number;
  createdAt: string;
  project: { name: string; client: { name: string } };
  _count: { items: number };
};

type Project = { id: string; name: string };

const statusColors: Record<string, string> = {
  draft: "bg-muted text-muted-foreground",
  in_progress: "bg-yellow-500/20 text-yellow-400",
  completed: "bg-green-500/20 text-green-400",
  cancelled: "bg-red-500/20 text-red-400",
};

const typeLabels: Record<string, string> = {
  inception: "Inception",
  continuous_improvement: "Melhoria Continua",
};

export default function DesignSessionsPage() {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({
    title: "", description: "", type: "inception", projectId: "",
  });
  const router = useRouter();

  const load = () => {
    fetch("/api/design-sessions").then((r) => r.json()).then(setSessions);
    fetch("/api/projects").then((r) => r.json()).then(setProjects);
  };

  useEffect(() => { load(); }, []);

  const create = async () => {
    const res = await fetch("/api/design-sessions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(form),
    });
    const session = await res.json();
    setOpen(false);
    router.push(`/design-sessions/${session.id}/steps/0`);
  };

  const remove = async (id: string) => {
    if (!confirm("Remover esta session?")) return;
    await fetch(`/api/design-sessions/${id}`, { method: "DELETE" });
    load();
  };

  const openSession = (s: Session) => {
    router.push(`/design-sessions/${s.id}/steps/${s.currentStep}`);
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Design Sessions"
        description="Sessoes de descoberta e alinhamento com clientes"
        onAdd={() => {
          setForm({ title: "", description: "", type: "inception", projectId: "" });
          setOpen(true);
        }}
        addLabel="Nova Session"
      />

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {sessions.map((s) => (
          <Card key={s.id} className="cursor-pointer hover:shadow-md transition-shadow" onClick={() => openSession(s)}>
            <CardHeader className="pb-2">
              <div className="flex items-start justify-between">
                <div>
                  <CardTitle className="text-base">{s.title}</CardTitle>
                  <p className="text-sm text-muted-foreground">
                    {s.project.client.name} — {s.project.name}
                  </p>
                </div>
                <div className="flex gap-1">
                  <Badge className={statusColors[s.status]}>{s.status}</Badge>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <div className="flex items-center justify-between text-sm">
                <Badge variant="outline">{typeLabels[s.type]}</Badge>
                <span className="text-muted-foreground">
                  Step {s.currentStep + 1}/{s.totalSteps}
                </span>
              </div>

              {/* Progress */}
              <div className="mt-2 h-1.5 w-full rounded-full bg-muted overflow-hidden">
                <div
                  className="h-full rounded-full bg-primary transition-all"
                  style={{ width: `${((s.currentStep + 1) / s.totalSteps) * 100}%` }}
                />
              </div>

              <div className="mt-3 flex items-center justify-between">
                <div className="flex gap-3 text-xs text-muted-foreground">
                  <span>{s._count.items} items</span>
                </div>
                <div className="flex gap-1" onClick={(e) => e.stopPropagation()}>
                  <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => openSession(s)}>
                    <Play className="h-3.5 w-3.5" />
                  </Button>
                  <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => remove(s.id)}>
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
        {sessions.length === 0 && (
          <div className="col-span-3 text-center py-12 text-muted-foreground">
            <FileText className="mx-auto h-8 w-8 mb-2 opacity-50" />
            <p>Nenhuma Design Session ainda.</p>
            <p className="text-sm">Crie a primeira para comecar a mapear requisitos.</p>
          </div>
        )}
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Nova Design Session</DialogTitle>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label>Projeto</Label>
              <Select value={form.projectId} onValueChange={(v) => v && setForm({ ...form, projectId: v })}>
                <SelectTrigger>
                  <SelectValue placeholder="Selecione o projeto">
                    {(value: string | null) => projects.find((p) => p.id === value)?.name ?? "Selecione o projeto"}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {projects.map((p) => (
                    <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-2">
              <Label>Tipo</Label>
              <Select value={form.type} onValueChange={(v) => v && setForm({ ...form, type: v })}>
                <SelectTrigger>
                  <SelectValue>
                    {(value: string | null) => typeLabels[value || ""] ?? value}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="inception">Inception — Projeto novo, escopo completo</SelectItem>
                  <SelectItem value="continuous_improvement">Melhoria Continua — Novas demandas</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-2">
              <Label>Titulo</Label>
              <Input
                value={form.title}
                onChange={(e) => setForm({ ...form, title: e.target.value })}
                placeholder="Ex: Inception TechCorp App"
              />
            </div>
            <div className="grid gap-2">
              <Label>Descricao (opcional)</Label>
              <Textarea
                value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
                placeholder="Objetivo e contexto da sessao"
                rows={3}
              />
            </div>
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setOpen(false)}>Cancelar</Button>
            <Button onClick={create} disabled={!form.title || !form.projectId}>
              Iniciar Session
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
