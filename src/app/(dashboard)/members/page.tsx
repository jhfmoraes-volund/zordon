"use client";

import { useEffect, useState, useCallback } from "react";
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
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Pencil, Trash2, ChevronDown, ChevronRight, Shield, Wand2, Copy, Gauge, Sparkles, MoreVertical } from "lucide-react";
import Link from "next/link";
import { useAuth } from "@/contexts/auth-context";
import {
  hasMinLevel, ADMIN,
  ROLES, ROLE_LABELS, roleLabel,
  SPECIALTIES, SPECIALTY_LABELS, specialtyLabel,
  type Role, type Specialty,
} from "@/lib/roles";
import { SkillProfileSheet } from "@/components/skill-assessment/skill-profile-sheet";
import { PixelBar, pixelTone } from "@/components/ui/pixel-bar";

function generatePassword(length = 14): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789";
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  let out = "";
  for (let i = 0; i < length; i++) out += alphabet[bytes[i] % alphabet.length];
  return out;
}

type Member = {
  id: string;
  name: string;
  email: string | null;
  role: string;
  specialty: string | null;
  githubUsername: string | null;
  isExternal: boolean;
  fpCapacity: number;
  /** Soma de FP em uso nas sprints que rodam na semana atual. */
  fpUsedWeek: number;
};

const roleDetails: Record<string, {
  label: string;
  summary: string;
  responsibilities: string[];
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
    suggestedCapacity: "30-40 FP/sprint (tasks de gestao)",
  },
  "product-builder": {
    label: "Product Builder",
    summary: "Executor principal de tasks tecnicas. Atua na especialidade definida (UX/UI, Backend, QA, Infra, Security ou Fullstack).",
    responsibilities: [
      "Implementar features end-to-end dentro da sua especialidade",
      "Escrever specs, acceptance criteria e technical notes",
      "Fazer code review do output dos agentes e de outros builders",
      "Garantir qualidade, performance e acessibilidade",
      "Apoiar outros builders em duvidas tecnicas da sua area",
    ],
    suggestedCapacity: "80-100 FP/sprint",
  },
  "principal-engineer": {
    label: "Principal Engineer",
    summary: "Referencia tecnica maxima. Define arquitetura, padroes e direcao tecnica da empresa. Atua cross-projeto em decisoes criticas.",
    responsibilities: [
      "Definir arquitetura e padroes tecnicos cross-projeto",
      "Avaliar e aprovar decisoes tecnicas de alto impacto",
      "Mentoria tecnica para builders seniors",
      "Investigar e resolver problemas tecnicos complexos",
      "Definir stack tecnologico e avaliar novas tecnologias",
      "Garantir consistencia tecnica entre projetos",
    ],
    suggestedCapacity: "30-50 FP/sprint (foco em arquitetura e decisoes, nao volume)",
  },
  "head-ops": {
    label: "Head Ops",
    summary: "Lider de operacoes. Garante que processos, squads e entregas funcionem de forma eficiente. Visao macro de todos os projetos.",
    responsibilities: [
      "Supervisionar a alocacao de squads e membros nos projetos",
      "Garantir aderencia aos processos e metodologia da empresa",
      "Monitorar indicadores de performance dos projetos (velocity, FP, prazos)",
      "Intervir em projetos com flags de atencao ou criticos",
      "Otimizar fluxos operacionais e remover impedimentos sistemicos",
      "Conduzir reunioes semanais de acompanhamento",
    ],
    suggestedCapacity: "N/A (gestao, nao executa tasks tecnicas)",
  },
  ceo: {
    label: "CEO",
    summary: "Visao estrategica do negocio. Acompanha saude dos projetos e toma decisoes de alto nivel sobre prioridades e investimentos.",
    responsibilities: [
      "Definir prioridades estrategicas e direcao da empresa",
      "Acompanhar saude geral dos projetos e satisfacao dos clientes",
      "Aprovar novos projetos e alocacao de recursos",
      "Tomar decisoes sobre escopo, prazo e investimento",
      "Representar a empresa perante clientes e parceiros",
      "Avaliar performance do time e resultados do negocio",
    ],
    suggestedCapacity: "N/A (estrategico, nao executa tasks)",
  },
};

const specialtyDetails: Record<string, {
  label: string;
  summary: string;
  responsibilities: string[];
}> = {
  "ux-ui": {
    label: "UX / UI",
    summary: "Traduz problemas em fluxos, jornadas e interfaces claras.",
    responsibilities: [
      "Define a estrutura de interacao (prototipos, navegacao e arquitetura de telas)",
      "Garante que o produto seja compreensivel sem necessidade de instrucoes",
      "Trabalha com hipoteses de comportamento do usuario (Jobs to Be Done, heuristicas)",
      "Aplica boas praticas de reutilizacao de componentes e consistencia visual",
      "Atua fortemente na validacao inicial (descoberta e testes rapidos)",
      "Se preocupa em manter a aplicacao otimizada do ponto de vista de performance percebida",
    ],
  },
  backend: {
    label: "Backend",
    summary: "Profundo conhecimento em Supabase e suas tecnologias associadas.",
    responsibilities: [
      "Responsavel por estruturar e garantir a funcionalidade do sistema de Auth",
      "Domina boas praticas para desenvolvimento de APIs, considerando limitacoes tecnicas e trade-offs de arquitetura",
      "Responsavel por garantir que funcoes server-side estejam corretamente configuradas (triggers, cron jobs, etc.)",
      "Atua na otimizacao de edge functions, buscando eficiencia e desempenho",
      "Gerencia a camada inicial de seguranca server-side, incluindo RLS (Row-Level Security) e gerenciamento de secrets",
    ],
  },
  qa: {
    label: "QA",
    summary: "Definicao e execucao de estrategias de teste (funcional, regressao, integracao e end-to-end).",
    responsibilities: [
      "Validacao de regras de negocio e fluxos criticos garantindo aderencia aos requisitos definidos",
      "Automacao de testes sempre que possivel (E2E, APIs e componentes criticos) para ganho de escala",
      "Identificacao, documentacao e priorizacao de bugs com clareza de impacto para o time",
    ],
  },
  infra: {
    label: "Infra",
    summary: "Responsavel por estruturar e manter ambientes (dev, staging e producao).",
    responsibilities: [
      "Define e implementa processos de deploy e CI/CD",
      "Garante escalabilidade, disponibilidade e resiliencia da aplicacao",
      "Monitora performance, erros e comportamento do sistema (observabilidade)",
      "Atua na gestao de infraestrutura em cloud (custos, recursos, otimizacao)",
      "Define padroes de arquitetura (serverless, containers, etc.)",
      "Cria mecanismos de rollback, backup e recuperacao de falhas",
    ],
  },
  security: {
    label: "Security",
    summary: "Mapeamento de superficie de ataque (APIs, endpoints, auth, edge functions, infra exposta).",
    responsibilities: [
      "Testes de vulnerabilidades em autenticacao e autorizacao (ex: bypass de auth, falhas em RLS, privilege escalation)",
      "Exploracao de falhas em APIs e backend (injecoes, exposicao de dados, validacao insuficiente)",
      "Testes em client-side (frontend) (XSS, armazenamento inseguro, vazamento de tokens)",
      "Simulacao de ataques reais (pentest manual + automatizado) cobrindo OWASP Top 10",
      "Reporte e priorizacao de riscos com recomendacoes claras de correcao (impacto vs esforco)",
    ],
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
  },
};

function MemberCardMobile({
  m,
  isAdmin,
  onOpenSkills,
  onEdit,
  onDelete,
}: {
  m: Member;
  isAdmin: boolean;
  onOpenSkills: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const usage = m.fpCapacity > 0 ? m.fpUsedWeek / m.fpCapacity : 0;
  const pct = Math.min(usage * 100, 999);
  const tone = pixelTone(pct, "load");

  return (
    <Link
      href={`/members/${m.id}`}
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
            <DropdownMenuItem onClick={onOpenSkills}>
              <Sparkles className="h-3.5 w-3.5 mr-2" />
              Perfil de skills
            </DropdownMenuItem>
            {isAdmin && (
              <>
                <DropdownMenuItem onClick={onEdit}>
                  <Pencil className="h-3.5 w-3.5 mr-2" />
                  Editar
                </DropdownMenuItem>
                <DropdownMenuItem variant="destructive" onClick={onDelete}>
                  <Trash2 className="h-3.5 w-3.5 mr-2" />
                  Excluir
                </DropdownMenuItem>
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {/* Header: nome + badges */}
      <div className="pr-10 space-y-1.5">
        <h3 className="font-medium text-base leading-tight truncate">{m.name}</h3>
        <div className="flex flex-wrap items-center gap-1.5">
          <Badge variant="outline" className="text-[10px]">{roleLabel(m.role)}</Badge>
          {m.specialty && (
            <Badge variant="secondary" className="text-[10px]">
              {specialtyLabel(m.specialty)}
            </Badge>
          )}
          {m.isExternal && (
            <Badge variant="outline" className="text-[10px] border-orange-400 text-orange-500">
              Externo
            </Badge>
          )}
        </div>
      </div>

      {/* Bateria de capacidade full-width */}
      <div className="space-y-1">
        <PixelBar score={pct} cells={10} height={10} variant="load" />
        <div className="flex items-center justify-between leading-none">
          <span className="text-[10px] uppercase tracking-wide text-muted-foreground/70">
            Carga da semana
          </span>
          <div className="flex items-center gap-2">
            <span
              className="font-mono text-sm tabular-nums leading-none"
              style={{ color: tone.fg }}
            >
              {Math.round(pct)}%
            </span>
            <span className="font-mono text-xs tabular-nums leading-none text-muted-foreground/70">
              {m.fpUsedWeek}/{m.fpCapacity}
              <span className="font-sans font-semibold text-[10px] tracking-[0.12em] uppercase ml-1">FP</span>
            </span>
          </div>
        </div>
      </div>
    </Link>
  );
}

export default function MembersPage() {
  const { realRole } = useAuth();
  const isAdmin = hasMinLevel(realRole, ADMIN);
  const [members, setMembers] = useState<Member[]>([]);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Member | null>(null);
  const [form, setForm] = useState({
    name: "", email: "", role: "product-builder", specialty: "fullstack",
    githubUsername: "", fpCapacity: "50", password: "", isExternal: false,
  });
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [skillSheetMemberId, setSkillSheetMemberId] = useState<string | null>(null);

  const load = useCallback(async () => {
    const supabase = createClient();
    const today = new Date().toISOString().slice(0, 10);

    // Sprints rodando hoje → membros que participam delas → soma de fp_used.
    const [membersRes, activeSprintsRes] = await Promise.all([
      supabase.from("Member").select("*").order("name"),
      supabase
        .from("Sprint")
        .select("id")
        .lte("startDate", today)
        .gte("endDate", today),
    ]);

    const activeSprintIds = (activeSprintsRes.data ?? []).map((s) => s.id);

    type WeekLoadRow = { memberId: string; fp_used: number };
    let weekRows: WeekLoadRow[] = [];
    if (activeSprintIds.length > 0) {
      const { data } = await supabase
        .from("sprint_member_capacity")
        .select("memberId, fp_used")
        .in("sprintId", activeSprintIds);
      weekRows = (data ?? []) as unknown as WeekLoadRow[];
    }

    const weekLoadMap = new Map<string, number>();
    for (const r of weekRows) {
      weekLoadMap.set(r.memberId, (weekLoadMap.get(r.memberId) ?? 0) + (r.fp_used ?? 0));
    }

    const merged: Member[] = (membersRes.data ?? []).map((m: Record<string, unknown>) => ({
      id: m.id as string,
      name: m.name as string,
      email: (m.email as string) ?? null,
      role: m.role as string,
      specialty: (m.specialty as string) ?? null,
      githubUsername: (m.githubUsername as string) ?? null,
      isExternal: (m.isExternal as boolean) ?? false,
      fpCapacity: (m.fpCapacity as number) ?? 0,
      fpUsedWeek: weekLoadMap.get(m.id as string) ?? 0,
    }));

    setMembers(merged);
  }, []);

  useEffect(() => { load(); }, [load]);

  const openNew = () => {
    setEditing(null);
    setSaveError(null);
    setForm({ name: "", email: "", role: "product-builder", specialty: "fullstack", githubUsername: "", fpCapacity: "50", password: generatePassword(), isExternal: false });
    setOpen(true);
  };

  const openEdit = (m: Member) => {
    setEditing(m);
    setSaveError(null);
    setForm({
      name: m.name,
      email: m.email || "",
      role: m.role,
      specialty: m.specialty || "fullstack",
      githubUsername: m.githubUsername || "",
      fpCapacity: String(m.fpCapacity),
      password: "",
      isExternal: m.isExternal,
    });
    setOpen(true);
  };

  const save = async () => {
    setSaving(true);
    setSaveError(null);
    const baseBody: Record<string, unknown> = {
      name: form.name,
      email: form.email || null,
      role: form.role,
      specialty: form.specialty || null,
      githubUsername: form.githubUsername || null,
      fpCapacity: parseInt(form.fpCapacity) || 50,
      isExternal: form.isExternal,
    };
    try {
      let res: Response;
      if (editing) {
        const body = form.password ? { ...baseBody, password: form.password } : baseBody;
        res = await fetch(`/api/members/${editing.id}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
      } else {
        res = await fetch("/api/members", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ...baseBody, password: form.password }),
        });
      }
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        setSaveError(err.error ?? `Erro ${res.status}`);
        return;
      }
      setOpen(false);
      load();
    } finally {
      setSaving(false);
    }
  };

  const remove = async (id: string) => {
    if (!confirm("Remover este membro?")) return;
    await fetch(`/api/members/${id}`, { method: "DELETE" });
    load();
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Membros"
        onAdd={isAdmin ? openNew : undefined}
        addLabel="Convidar membro"
      />

      {/* Mobile: cards */}
      <div className="md:hidden space-y-3">
        {members.map((m) => (
          <MemberCardMobile
            key={m.id}
            m={m}
            isAdmin={isAdmin}
            onOpenSkills={() => setSkillSheetMemberId(m.id)}
            onEdit={() => openEdit(m)}
            onDelete={() => remove(m.id)}
          />
        ))}
        {members.length === 0 && (
          <div className="surface p-8 text-center text-muted-foreground text-sm">
            Nenhum membro cadastrado.
          </div>
        )}
      </div>

      {/* Desktop: tabela */}
      <div className="surface hidden md:block">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Nome</TableHead>
              <TableHead>Role</TableHead>
              <TableHead>Especialidade</TableHead>
              <TableHead className="w-[180px]">Carga da semana</TableHead>
              <TableHead className="w-[100px]" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {members.map((m) => {
              const usage = m.fpCapacity > 0 ? m.fpUsedWeek / m.fpCapacity : 0;
              return (
                <TableRow key={m.id}>
                  <TableCell className="font-medium">
                    {m.name}
                    {m.isExternal && (
                      <Badge variant="outline" className="ml-2 text-[10px] border-orange-400 text-orange-500">
                        Externo
                      </Badge>
                    )}
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline">{roleLabel(m.role)}</Badge>
                  </TableCell>
                  <TableCell>
                    {m.specialty && (
                      <Badge variant="secondary" className="text-xs">
                        {specialtyLabel(m.specialty)}
                      </Badge>
                    )}
                  </TableCell>
                  <TableCell>
                    {(() => {
                      const pct = Math.min(usage * 100, 999);
                      const tone = pixelTone(pct, "load");
                      return (
                        <div className="space-y-1">
                          <PixelBar score={pct} cells={10} height={10} variant="load" />
                          <div className="flex items-center justify-between leading-none">
                            <span
                              className="font-mono text-sm tabular-nums leading-none"
                              style={{ color: tone.fg }}
                            >
                              {Math.round(pct)}%
                            </span>
                            <span className="font-mono text-sm tabular-nums leading-none text-muted-foreground/70">
                              {m.fpUsedWeek}/{m.fpCapacity}
                              <span className="font-sans font-semibold text-[10px] tracking-[0.12em] uppercase ml-1">FP</span>
                            </span>
                          </div>
                        </div>
                      );
                    })()}
                  </TableCell>
                  <TableCell>
                    <div className="flex gap-1">
                      <Button
                        variant="ghost"
                        size="icon"
                        title="Ver perfil de skills"
                        onClick={() => setSkillSheetMemberId(m.id)}
                      >
                        <Sparkles className="h-4 w-4" />
                      </Button>
                      <Link href={`/members/${m.id}`}>
                        <Button variant="ghost" size="icon" title="Ver capacity detalhada">
                          <Gauge className="h-4 w-4" />
                        </Button>
                      </Link>
                      {isAdmin && (
                        <>
                          <Button variant="ghost" size="icon" onClick={() => openEdit(m)}>
                            <Pencil className="h-4 w-4" />
                          </Button>
                          <Button variant="ghost" size="icon" onClick={() => remove(m.id)}>
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              );
            })}
            {members.length === 0 && (
              <TableRow>
                <TableCell colSpan={5} className="text-center text-muted-foreground py-8">
                  Nenhum membro cadastrado.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      {/* ─── Roles ─── */}
      <div>
        <h2 className="text-sm font-semibold text-muted-foreground mb-3 flex items-center gap-2">
          <Shield className="h-4 w-4" /> Roles
        </h2>
        <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
          {Object.entries(roleDetails).map(([key, role]) => {
            const count = members.filter((m) => m.role === key).length;
            return (
              <DetailCard key={key} label={role.label} summary={role.summary} responsibilities={role.responsibilities} extra={role.suggestedCapacity} count={count} />
            );
          })}
        </div>
      </div>

      {/* ─── Especialidades ─── */}
      <div>
        <h2 className="text-sm font-semibold text-muted-foreground mb-3 flex items-center gap-2">
          <Shield className="h-4 w-4" /> Especialidades
        </h2>
        <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
          {Object.entries(specialtyDetails).map(([key, spec]) => {
            const count = members.filter((m) => m.specialty === key).length;
            return (
              <DetailCard key={key} label={spec.label} summary={spec.summary} responsibilities={spec.responsibilities} count={count} />
            );
          })}
        </div>
      </div>

      <SkillProfileSheet
        memberId={skillSheetMemberId}
        open={!!skillSheetMemberId}
        onOpenChange={(o) => { if (!o) setSkillSheetMemberId(null); }}
      />

      <ResponsiveDialog open={open} onOpenChange={setOpen}>
        <ResponsiveDialogContent>
          <ResponsiveDialogHeader>
            <ResponsiveDialogTitle>{editing ? "Editar membro" : "Adicionar membro"}</ResponsiveDialogTitle>
            {!editing && (
              <p className="text-xs text-muted-foreground">
                A senha sera definida agora. Compartilhe com o membro fora do sistema (Slack, etc).
              </p>
            )}
          </ResponsiveDialogHeader>
          <ResponsiveDialogBody className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label>Nome</Label>
              <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            </div>
            <div className="grid gap-2">
              <Label>Email</Label>
              <Input
                type="email"
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
                disabled={!!editing}
              />
              {editing && (
                <p className="text-[10px] text-muted-foreground">
                  Email nao pode ser alterado depois da criacao.
                </p>
              )}
            </div>
            <div className="grid gap-2">
              <Label>
                Senha {editing && <span className="text-muted-foreground font-normal">(opcional — preencher so pra resetar)</span>}
              </Label>
              <div className="flex gap-2">
                <Input
                  type="text"
                  value={form.password}
                  onChange={(e) => setForm({ ...form, password: e.target.value })}
                  className="font-mono"
                  placeholder={editing ? "Deixe em branco pra manter a senha atual" : ""}
                />
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  title="Gerar senha"
                  onClick={() => setForm({ ...form, password: generatePassword() })}
                >
                  <Wand2 className="h-4 w-4" />
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  title="Copiar"
                  disabled={!form.password}
                  onClick={() => navigator.clipboard.writeText(form.password)}
                >
                  <Copy className="h-4 w-4" />
                </Button>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <input
                type="checkbox"
                id="isExternal"
                checked={form.isExternal}
                onChange={(e) => setForm({ ...form, isExternal: e.target.checked })}
                className="h-4 w-4 rounded border-input accent-orange-500"
              />
              <Label htmlFor="isExternal" className="cursor-pointer">
                Membro externo <span className="text-muted-foreground font-normal">(cedido por outra empresa, ex: Extreme Group)</span>
              </Label>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="grid gap-2">
                <Label>Role</Label>
                <Select value={form.role} onValueChange={(v) => v && setForm({ ...form, role: v })}>
                  <SelectTrigger>
                    <SelectValue>
                      {(value: string | null) => roleLabel(value)}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {ROLES.map((r) => (
                      <SelectItem key={r} value={r}>{ROLE_LABELS[r]}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-2">
                <Label>Especialidade</Label>
                <Select value={form.specialty} onValueChange={(v) => v && setForm({ ...form, specialty: v })}>
                  <SelectTrigger>
                    <SelectValue>
                      {(value: string | null) => specialtyLabel(value)}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {SPECIALTIES.map((s) => (
                      <SelectItem key={s} value={s}>{SPECIALTY_LABELS[s]}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="grid gap-2">
                <Label>GitHub Username</Label>
                <Input value={form.githubUsername} onChange={(e) => setForm({ ...form, githubUsername: e.target.value })} />
              </div>
              <div className="grid gap-2">
                <Label>FP Capacity por Sprint</Label>
                <Input
                  type="number"
                  value={form.fpCapacity}
                  onChange={(e) => setForm({ ...form, fpCapacity: e.target.value })}
                />
              </div>
            </div>
            {saveError && (
              <p className="text-xs text-destructive">{saveError}</p>
            )}
          </ResponsiveDialogBody>
          <ResponsiveDialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)} disabled={saving}>Cancelar</Button>
            <Button
              onClick={save}
              disabled={
                saving ||
                !form.name ||
                !form.email ||
                (!editing && form.password.length < 6)
              }
            >
              {saving ? "Salvando..." : editing ? "Salvar" : "Criar membro"}
            </Button>
          </ResponsiveDialogFooter>
        </ResponsiveDialogContent>
      </ResponsiveDialog>
    </div>
  );
}

// ─── Detail Card (reused for roles and specialties) ──────

function DetailCard({
  label, summary, responsibilities, extra, count,
}: {
  label: string; summary: string; responsibilities: string[]; extra?: string; count: number;
}) {
  const [expanded, setExpanded] = useState(false);

  return (
    <Card
      className="cursor-pointer hover:ring-foreground/10 transition-all"
      onClick={() => setExpanded(!expanded)}
    >
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm">{label}</CardTitle>
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
        <p className="text-xs text-muted-foreground leading-relaxed">{summary}</p>
      </CardHeader>

      {expanded && (
        <CardContent className="pt-0 space-y-3">
          <div>
            <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide mb-1.5">Responsabilidades</p>
            <ul className="space-y-1">
              {responsibilities.map((r, i) => (
                <li key={i} className="text-xs text-muted-foreground flex items-start gap-1.5">
                  <span className="text-muted-foreground/50 mt-0.5">•</span>
                  <span>{r}</span>
                </li>
              ))}
            </ul>
          </div>

          {extra && (
            <div className="flex items-center justify-between pt-1 border-t border-foreground/5">
              <span className="text-[10px] text-muted-foreground uppercase tracking-wide">Capacity sugerido</span>
              <span className="text-xs font-medium">{extra}</span>
            </div>
          )}
        </CardContent>
      )}
    </Card>
  );
}
