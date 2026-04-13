"use client";

import React, { useEffect, useState } from "react";
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
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Pencil, Trash2, ChevronDown, ChevronRight, Bot, Shield } from "lucide-react";

type Member = {
  id: string;
  name: string;
  email: string | null;
  role: string;
  githubUsername: string | null;
  hourlyCost: number;
  fpCapacity: number;
  fpAllocated: number;
  _count: { squadMemberships: number; taskAssignments: number };
};

type CapacitySprint = {
  sprintId: string;
  sprintName: string;
  startDate: string;
  endDate: string;
  sprintStatus: string;
  totalFp: number;
  usage: number;
  projects: { projectId: string; projectName: string; sp: number }[];
};

type CapacityData = {
  member: { id: string; name: string; fpCapacity: number };
  sprints: CapacitySprint[];
};

const roles = [
  { value: "pm", label: "Project Manager" },
  { value: "ui-ux-builder", label: "UI/UX Builder" },
  { value: "backend-qa-builder", label: "Backend/QA Builder" },
  { value: "fullstack", label: "Fullstack" },
  { value: "tech-specialist", label: "Tech Specialist" },
];

const roleDetails: Record<string, {
  label: string;
  summary: string;
  responsibilities: string[];
  agentRelation: string;
  suggestedCapacity: string;
}> = {
  pm: {
    label: "Project Manager",
    summary: "Coordena o squad, alinha com o cliente e garante que o projeto avanca no ritmo planejado. Nao executa tasks tecnicas.",
    responsibilities: [
      "Conduzir dailies e remover bloqueios",
      "Alinhar expectativas e prioridades com o cliente",
      "Validar entregas contra criterios de aceite (QA de aceite)",
      "Planejar sprints e distribuir tasks por capacity",
      "Monitorar velocity e flags de atencao",
      "Preparar e conduzir demos a cada sprint",
    ],
    agentRelation: "Define prioridades que determinam a ordem de execucao dos agentes. Valida o output final, nao o codigo.",
    suggestedCapacity: "30-40 FP/sprint (tasks de gestao)",
  },
  "ui-ux-builder": {
    label: "UI/UX Builder",
    summary: "Responsavel pela interface e experiencia do usuario. Cria componentes reutilizaveis e valida o output visual dos agentes.",
    responsibilities: [
      "Implementar componentes de UI e design system",
      "Escrever UI guidance nas specs para guiar agentes",
      "Validar output visual gerado por agentes (pixel review)",
      "Garantir responsividade e acessibilidade",
      "Criar prototipos e fluxos de interacao",
    ],
    agentRelation: "Escreve specs de UI que os agentes consomem. Os componentes reutilizaveis que cria viram blocos que o agente monta. Faz review visual do output.",
    suggestedCapacity: "80-100 FP/sprint",
  },
  "backend-qa-builder": {
    label: "Backend/QA Builder",
    summary: "Implementa APIs, logica de negocio e integracoes. Garante qualidade do codigo humano e do gerado por agentes.",
    responsibilities: [
      "Implementar APIs, models e logica de negocio",
      "Escrever technical notes e acceptance criteria nas specs",
      "Fazer code review do output dos agentes",
      "Implementar integracoes com servicos externos",
      "Escrever e manter testes",
    ],
    agentRelation: "As technical notes que escreve sao o principal input dos agentes para gerar codigo backend. Faz review tecnico do output gerado.",
    suggestedCapacity: "80-100 FP/sprint",
  },
  fullstack: {
    label: "Fullstack",
    summary: "Atua em frontend e backend conforme demanda. Coringa do squad que desbloqueia gargalos onde necessario.",
    responsibilities: [
      "Implementar features end-to-end (API + UI)",
      "Desbloquear gargalos — assume tasks de UI ou backend conforme necessidade",
      "Setup de projeto, infra e CI/CD",
      "Definir arquitetura e padroes de codigo",
      "Apoiar outros builders em duvidas tecnicas",
    ],
    agentRelation: "Pode atuar como UI/UX Builder ou Backend/QA Builder na relacao com agentes. Define a arquitetura que os agentes devem seguir.",
    suggestedCapacity: "80-100 FP/sprint",
  },
  "tech-specialist": {
    label: "Tech Specialist",
    summary: "Senior com profundo conhecimento de codigo e arquitetura. Responsavel pela auditoria tecnica e homologacao final antes de producao.",
    responsibilities: [
      "Auditoria de codigo — review final de toda entrega antes de produção",
      "Homologacao tecnica — gate de qualidade que valida seguranca, performance e padroes",
      "Avaliar output dos agentes IA com olho critico de senior",
      "Identificar debito tecnico e riscos arquiteturais",
      "Definir e manter padroes de codigo, guidelines e conventions",
      "Mentoria tecnica para os builders do squad",
    ],
    agentRelation: "Ultimo gate antes de producao. Audita tanto codigo humano quanto gerado por agentes. Define as guidelines tecnicas que alimentam os prompts dos agentes.",
    suggestedCapacity: "40-60 FP/sprint (foco em review, nao em volume de output)",
  },
};

function usageColor(usage: number) {
  if (usage <= 0.7) return "bg-green-500";
  if (usage <= 0.9) return "bg-yellow-500";
  return "bg-red-500";
}

function usageBadgeVariant(usage: number): "default" | "secondary" | "destructive" {
  if (usage <= 0.7) return "secondary";
  if (usage <= 0.9) return "default";
  return "destructive";
}

export default function MembersPage() {
  const [members, setMembers] = useState<Member[]>([]);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Member | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [capacityData, setCapacityData] = useState<CapacityData | null>(null);
  const [loadingCapacity, setLoadingCapacity] = useState(false);
  const [form, setForm] = useState({
    name: "", email: "", role: "fullstack", githubUsername: "", hourlyCost: "0", fpCapacity: "50",
  });

  const load = () =>
    fetch("/api/members").then((r) => r.json()).then(setMembers);

  useEffect(() => { load(); }, []);

  const toggleExpand = async (id: string) => {
    if (expandedId === id) {
      setExpandedId(null);
      setCapacityData(null);
      return;
    }
    setExpandedId(id);
    setLoadingCapacity(true);
    try {
      const res = await fetch(`/api/members/${id}/capacity`);
      const data = await res.json();
      setCapacityData(data);
    } finally {
      setLoadingCapacity(false);
    }
  };

  const openNew = () => {
    setEditing(null);
    setForm({ name: "", email: "", role: "fullstack", githubUsername: "", hourlyCost: "0", fpCapacity: "50" });
    setOpen(true);
  };

  const openEdit = (m: Member) => {
    setEditing(m);
    setForm({
      name: m.name,
      email: m.email || "",
      role: m.role,
      githubUsername: m.githubUsername || "",
      hourlyCost: String(m.hourlyCost),
      fpCapacity: String(m.fpCapacity),
    });
    setOpen(true);
  };

  const save = async () => {
    const body = {
      name: form.name,
      email: form.email || null,
      role: form.role,
      githubUsername: form.githubUsername || null,
      hourlyCost: parseFloat(form.hourlyCost) || 0,
      fpCapacity: parseInt(form.fpCapacity) || 50,
    };
    if (editing) {
      await fetch(`/api/members/${editing.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
    } else {
      await fetch("/api/members", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
    }
    setOpen(false);
    load();
  };

  const remove = async (id: string) => {
    if (!confirm("Remover este membro?")) return;
    await fetch(`/api/members/${id}`, { method: "DELETE" });
    load();
  };

  return (
    <div className="space-y-6">
      <PageHeader title="Membros" onAdd={openNew} addLabel="Novo Membro" />

      <div className="surface">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-[30px]" />
              <TableHead>Nome</TableHead>
              <TableHead>Role</TableHead>
              <TableHead>FP Capacity</TableHead>
              <TableHead>FP Alocados</TableHead>
              <TableHead>Carga</TableHead>
              <TableHead>Squads</TableHead>
              <TableHead className="w-[100px]" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {members.map((m) => {
              const usage = m.fpCapacity > 0 ? m.fpAllocated / m.fpCapacity : 0;
              const isExpanded = expandedId === m.id;
              return (
                <React.Fragment key={m.id}>
                  <TableRow className="cursor-pointer" onClick={() => toggleExpand(m.id)}>
                    <TableCell>
                      {isExpanded
                        ? <ChevronDown className="h-4 w-4 text-muted-foreground" />
                        : <ChevronRight className="h-4 w-4 text-muted-foreground" />}
                    </TableCell>
                    <TableCell className="font-medium">{m.name}</TableCell>
                    <TableCell>
                      <Badge variant="outline">
                        {roles.find((r) => r.value === m.role)?.label || m.role}
                      </Badge>
                    </TableCell>
                    <TableCell>{m.fpCapacity} FP</TableCell>
                    <TableCell>{m.fpAllocated} FP</TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <div className="h-2 w-20 rounded-full bg-secondary overflow-hidden">
                          <div
                            className={`h-full rounded-full transition-all ${usageColor(usage)}`}
                            style={{ width: `${Math.min(usage * 100, 100)}%` }}
                          />
                        </div>
                        <Badge variant={usageBadgeVariant(usage)} className="text-xs">
                          {Math.round(usage * 100)}%
                        </Badge>
                      </div>
                    </TableCell>
                    <TableCell>{m._count.squadMemberships}</TableCell>
                    <TableCell>
                      <div className="flex gap-1" onClick={(e) => e.stopPropagation()}>
                        <Button variant="ghost" size="icon" onClick={() => openEdit(m)}>
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button variant="ghost" size="icon" onClick={() => remove(m.id)}>
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                  {isExpanded && (
                    <TableRow>
                      <TableCell />
                      <TableCell colSpan={8}>
                        {loadingCapacity ? (
                          <p className="text-sm text-muted-foreground py-4">Carregando capacity...</p>
                        ) : capacityData && capacityData.sprints.length > 0 ? (
                          <div className="py-3 space-y-3">
                            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                              Alocacao por Sprint
                            </p>
                            <div className="space-y-2">
                              {capacityData.sprints.map((s) => {
                                const fmt = (d: string) =>
                                  new Date(d).toLocaleDateString("pt-BR", { day: "2-digit", month: "short" });
                                return (
                                  <div key={s.sprintId} className="flex items-center gap-3">
                                    <div className="w-40 text-sm truncate" title={s.sprintName}>
                                      {s.sprintName}
                                    </div>
                                    <div className="text-xs text-muted-foreground w-28">
                                      {fmt(s.startDate)} — {fmt(s.endDate)}
                                    </div>
                                    <div className="flex-1">
                                      <div className="h-4 w-full rounded bg-secondary overflow-hidden flex">
                                        {s.projects.map((p) => {
                                          const pct = capacityData.member.fpCapacity > 0
                                            ? (p.sp / capacityData.member.fpCapacity) * 100
                                            : 0;
                                          return (
                                            <div
                                              key={p.projectId}
                                              className={`h-full ${usageColor(s.usage)} opacity-80 first:rounded-l last:rounded-r`}
                                              style={{ width: `${Math.min(pct, 100)}%` }}
                                              title={`${p.projectName}: ${p.sp} FP`}
                                            />
                                          );
                                        })}
                                      </div>
                                    </div>
                                    <div className="text-sm font-medium w-20 text-right">
                                      {s.totalFp}/{capacityData.member.fpCapacity} FP
                                    </div>
                                    <Badge variant={usageBadgeVariant(s.usage)} className="text-xs w-14 justify-center">
                                      {Math.round(s.usage * 100)}%
                                    </Badge>
                                  </div>
                                );
                              })}
                            </div>
                            {/* Legend: projects */}
                            <div className="flex flex-wrap gap-3 pt-2 border-t">
                              {Array.from(
                                new Map(
                                  capacityData.sprints.flatMap((s) =>
                                    s.projects.map((p) => [p.projectId, p.projectName])
                                  )
                                )
                              ).map(([id, name]) => (
                                <span key={id} className="text-xs text-muted-foreground">
                                  {name}
                                </span>
                              ))}
                            </div>
                          </div>
                        ) : (
                          <p className="text-sm text-muted-foreground py-4">
                            Nenhuma alocacao em sprints.
                          </p>
                        )}
                      </TableCell>
                    </TableRow>
                  )}
                </React.Fragment>
              );
            })}
            {members.length === 0 && (
              <TableRow>
                <TableCell colSpan={9} className="text-center text-muted-foreground py-8">
                  Nenhum membro cadastrado.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      {/* ─── Member Roles ─── */}
      <div>
        <h2 className="text-sm font-semibold text-muted-foreground mb-3 flex items-center gap-2">
          <Shield className="h-4 w-4" /> Member Roles
        </h2>
        <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
          {Object.entries(roleDetails).map(([key, role]) => {
            const count = members.filter((m) => m.role === key).length;
            return (
              <RoleCard key={key} roleKey={key} role={role} count={count} />
            );
          })}
        </div>
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editing ? "Editar Membro" : "Novo Membro"}</DialogTitle>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label>Nome</Label>
              <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            </div>
            <div className="grid gap-2">
              <Label>Email</Label>
              <Input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
            </div>
            <div className="grid gap-2">
              <Label>Role</Label>
              <Select value={form.role} onValueChange={(v) => v && setForm({ ...form, role: v })}>
                <SelectTrigger>
                  <SelectValue>
                    {(value: string | null) => roles.find((r) => r.value === value)?.label ?? value}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {roles.map((r) => (
                    <SelectItem key={r.value} value={r.value}>{r.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="grid gap-2">
                <Label>GitHub Username</Label>
                <Input value={form.githubUsername} onChange={(e) => setForm({ ...form, githubUsername: e.target.value })} />
              </div>
              <div className="grid gap-2">
                <Label>Custo/hora (R$)</Label>
                <Input type="number" value={form.hourlyCost} onChange={(e) => setForm({ ...form, hourlyCost: e.target.value })} />
              </div>
            </div>
            <div className="grid gap-2">
              <Label>FP Capacity por Sprint</Label>
              <Input
                type="number"
                value={form.fpCapacity}
                onChange={(e) => setForm({ ...form, fpCapacity: e.target.value })}
              />
              <p className="text-xs text-muted-foreground">
                Quantidade de Function Points que o membro entrega por sprint (15 dias).
              </p>
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

// ─── Role Card ──────────────────────────────────────────────

function RoleCard({
  roleKey,
  role,
  count,
}: {
  roleKey: string;
  role: typeof roleDetails[string];
  count: number;
}) {
  const [expanded, setExpanded] = useState(false);

  return (
    <Card
      className="cursor-pointer hover:ring-foreground/10 transition-all"
      onClick={() => setExpanded(!expanded)}
    >
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm">{role.label}</CardTitle>
          <div className="flex items-center gap-2">
            {count > 0 && (
              <Badge variant="secondary" className="text-[10px]">{count} membro{count > 1 ? "s" : ""}</Badge>
            )}
            {expanded
              ? <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
              : <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
            }
          </div>
        </div>
        <p className="text-xs text-muted-foreground leading-relaxed">{role.summary}</p>
      </CardHeader>

      {expanded && (
        <CardContent className="pt-0 space-y-3">
          {/* Responsibilities */}
          <div>
            <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide mb-1.5">Responsabilidades</p>
            <ul className="space-y-1">
              {role.responsibilities.map((r, i) => (
                <li key={i} className="text-xs text-muted-foreground flex items-start gap-1.5">
                  <span className="text-muted-foreground/50 mt-0.5">•</span>
                  <span>{r}</span>
                </li>
              ))}
            </ul>
          </div>

          {/* Relation with AI agents */}
          <div className="surface-nested p-2.5">
            <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide mb-1 flex items-center gap-1">
              <Bot className="h-3 w-3" /> Relacao com agentes IA
            </p>
            <p className="text-xs text-muted-foreground leading-relaxed">{role.agentRelation}</p>
          </div>

          {/* Suggested capacity */}
          <div className="flex items-center justify-between pt-1 border-t border-foreground/5">
            <span className="text-[10px] text-muted-foreground uppercase tracking-wide">Capacity sugerido</span>
            <span className="text-xs font-medium">{role.suggestedCapacity}</span>
          </div>
        </CardContent>
      )}
    </Card>
  );
}
