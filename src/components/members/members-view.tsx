"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { loadMembersList, type MembersListItem } from "@/lib/members/members-load";
import { useOptimisticCollection } from "@/hooks/use-optimistic-collection";
import { fetchOrThrow } from "@/lib/optimistic/toast";
import { PageHeader } from "@/components/page-header";
import { PageContainer } from "@/components/app-shell";
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
import { ConfirmDialog, type ConfirmState } from "@/components/ui/confirm-dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Pencil, Trash2, ChevronDown, ChevronRight, Shield, Wand2, Copy, Gauge, Sparkles, MoreVertical, icons as lucideIcons, Star } from "lucide-react";
import Link from "next/link";
import { useAuth } from "@/contexts/auth-context";
import {
  hasMinLevel, ADMIN,
  hasMinAccessLevel,
  SPECIALTIES, SPECIALTY_LABELS, specialtyLabel,
  POSITIONS, POSITION_LABELS, positionLabel,
  MEMBER_ACCESS_LEVELS, ACCESS_LEVEL_LABELS, mapPositionToAccessLevel,
  type AccessLevel,
} from "@/lib/roles";
import { SkillProfileSheet } from "@/components/skill-assessment/skill-profile-sheet";
import { PixelBar, pixelTone, PixelHud } from "@/components/ui/pixel-bar";
import {
  TOWERS,
  scoreLabel,
  towerLabel,
  type Tower,
} from "@/lib/memberSkills";

function generatePassword(length = 14): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789";
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  let out = "";
  for (let i = 0; i < length; i++) out += alphabet[bytes[i] % alphabet.length];
  return out;
}

// Member = MembersListItem (vem do loader). Re-export como type local
// pra minimizar diff no resto do arquivo.
type Member = MembersListItem;

// ─── Member category filter ──────────────────────────────
// Três categorias mutuamente exclusivas derivadas de isGuest/isExternal:
// guest (Member-stub, só comenta), externo (cedido por outra empresa),
// membro (interno). "all" mostra todos.
type MemberFilter = "all" | "internal" | "guest" | "external";

function memberCategory(m: Member): Exclude<MemberFilter, "all"> {
  if (m.isGuest) return "guest";
  if (m.isExternal) return "external";
  return "internal";
}

const MEMBER_FILTER_LABELS: Record<MemberFilter, string> = {
  all: "Todos",
  internal: "Membros",
  guest: "Guests",
  external: "Externos",
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
    suggestedCapacity: "30-40 PFV/sprint (tasks de gestao)",
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
    suggestedCapacity: "80-100 PFV/sprint",
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
    suggestedCapacity: "30-50 PFV/sprint (foco em arquitetura e decisoes, nao volume)",
  },
  "head-ops": {
    label: "Head Ops",
    summary: "Lider de operacoes. Garante que processos, squads e entregas funcionem de forma eficiente. Visao macro de todos os projetos.",
    responsibilities: [
      "Supervisionar a alocacao de squads e membros nos projetos",
      "Garantir aderencia aos processos e metodologia da empresa",
      "Monitorar indicadores de performance dos projetos (velocity, PFV, prazos)",
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
  cro: {
    label: "CRO",
    summary: "Lider comercial e de receita. Responsavel por crescimento, novos clientes e relacionamento com a base ativa.",
    responsibilities: [
      "Definir e executar a estrategia comercial e de receita",
      "Prospectar e fechar novos clientes",
      "Gerir o relacionamento e expansao da base ativa",
      "Acompanhar pipeline, forecast e metas de receita",
      "Representar a empresa em negociacoes e parcerias estrategicas",
      "Alinhar com CEO e Head Ops sobre capacidade e priorizacao comercial",
    ],
    suggestedCapacity: "N/A (estrategico, nao executa tasks)",
  },
};

function MemberCardMobile({
  m,
  isAdmin,
  canViewCapacity,
  onOpenSkills,
  onEdit,
  onDelete,
}: {
  m: Member;
  isAdmin: boolean;
  canViewCapacity: boolean;
  onOpenSkills: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const usage = m.fpCapacity > 0 ? m.fpPlannedWeek / m.fpCapacity : 0;
  const pct = Math.min(usage * 100, 999);
  const tone = pixelTone(pct, "load");

  // Builder doesn't get to drill into the per-member capacity page; the card
  // renders as a non-clickable container in that case.
  const wrapperClass =
    "surface block p-4 space-y-3 relative active:bg-accent/40 transition-colors";

  const inner = (
    <>
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
          <Badge variant="outline" className="text-[10px]">{positionLabel(m.position)}</Badge>
          {m.primaryTower && (
            <Badge variant="secondary" className="text-[10px]">
              {towerLabel(m.primaryTower)}
            </Badge>
          )}
          {m.fullstack && (
            <Badge className="text-[10px] bg-amber-500/15 text-amber-600 border border-amber-500/30 hover:bg-amber-500/15">
              <Star className="h-2.5 w-2.5 mr-1 fill-current" />
              Fullstack
            </Badge>
          )}
          {m.isGuest && (
            <Badge variant="outline" className="text-[10px] border-sky-400 text-sky-500">
              Guest
            </Badge>
          )}
          {m.isExternal && !m.isGuest && (
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
              {m.fpPlannedWeek}/{m.fpCapacity}
              <span className="font-sans font-semibold text-[10px] tracking-[0.12em] uppercase ml-1">PFV</span>
            </span>
          </div>
        </div>
      </div>
    </>
  );

  if (canViewCapacity) {
    return (
      <Link href={`/members/${m.id}`} className={wrapperClass}>
        {inner}
      </Link>
    );
  }
  return <div className={wrapperClass}>{inner}</div>;
}

export function MembersView({ initial }: { initial: Member[] }) {
  const { realRole, effectiveAccessLevel } = useAuth();
  const isAdmin = hasMinLevel(realRole, ADMIN);
  // Builder gets a read-only view: directory listing + skills sheet only.
  // Capacity drilldown (Gauge → /members/[id]) is manager+ since it shows
  // PFV allocation/commitment data that's planning territory.
  const canViewCapacity = hasMinAccessLevel(effectiveAccessLevel, "manager");
  const membersCollection = useOptimisticCollection<Member>(initial);
  const members = membersCollection.items;
  const setMembers = membersCollection.setCommitted;
  const memberMutate = membersCollection.mutate;
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Member | null>(null);
  const [form, setForm] = useState<{
    name: string;
    email: string;
    position: string;
    accessLevel: AccessLevel;
    specialty: string;
    githubUsername: string;
    fpCapacity: string;
    password: string;
    isExternal: boolean;
  }>({
    name: "", email: "", position: "product-builder", accessLevel: "builder",
    specialty: "fullstack",
    githubUsername: "", fpCapacity: "50", password: "", isExternal: false,
  });
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [skillSheetMemberId, setSkillSheetMemberId] = useState<string | null>(null);
  const [filter, setFilter] = useState<MemberFilter>("all");
  const [confirmState, setConfirmState] = useState<ConfirmState | null>(null);

  // Contagem por categoria (sempre sobre o conjunto completo, independente do
  // filtro ativo) pra rotular as opções do Select.
  const counts = members.reduce(
    (acc, m) => {
      acc.all += 1;
      acc[memberCategory(m)] += 1;
      return acc;
    },
    { all: 0, internal: 0, guest: 0, external: 0 } as Record<MemberFilter, number>,
  );

  const visibleMembers =
    filter === "all" ? members : members.filter((m) => memberCategory(m) === filter);

  // Roles e Torres descrevem a composição do time (interno + externos), não
  // guests — que são stubs sem position/skill. Sempre excluem guests,
  // independente do filtro da tabela.
  const teamMembers = members.filter((m) => !m.isGuest);

  const reload = async () => {
    const supabase = createClient();
    setMembers(await loadMembersList(supabase));
  };

  const openNew = () => {
    setEditing(null);
    setSaveError(null);
    setForm({
      name: "",
      email: "",
      position: "product-builder",
      accessLevel: "builder",
      specialty: "fullstack",
      githubUsername: "",
      fpCapacity: "50",
      password: generatePassword(),
      isExternal: false,
    });
    setOpen(true);
  };

  const openEdit = (m: Member) => {
    setEditing(m);
    setSaveError(null);
    const memberPosition = (m.position ?? m.role) as string;
    setForm({
      name: m.name,
      email: m.email || "",
      position: memberPosition,
      // Edit defaults: derive accessLevel from position. The UI doesn't load
      // the user's real `app_metadata.access_level` (that lives in auth.users),
      // so an admin who promoted someone manually will see the derived value
      // here. Submitting only changes accessLevel if the admin picks a different
      // value — see the PUT handler.
      accessLevel: mapPositionToAccessLevel(memberPosition),
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
      position: form.position,
      accessLevel: form.accessLevel,
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
      reload();
    } finally {
      setSaving(false);
    }
  };

  const remove = (id: string) => {
    const name = members.find((m) => m.id === id)?.name;
    setConfirmState({
      title: name ? `Remover ${name}?` : "Remover este membro?",
      description: "Esse membro será removido permanentemente.",
      confirmLabel: "Remover",
      destructive: true,
      onConfirm: async () => {
        await memberMutate(
          { type: "delete", id },
          async (signal) => {
            const res = await fetchOrThrow(`/api/members/${id}`, {
              method: "DELETE",
              signal,
            });
            return (await res.json().catch(() => ({}))) as { ok?: true };
          },
          {
            errorLabel: "Falha ao remover membro",
            reconcile: (prev) => prev.filter((m) => m.id !== id),
          },
        );
      },
    });
  };

  return (
    <PageContainer>
      <div className="space-y-6">
        <PageHeader
          title="Membros"
          onAdd={isAdmin ? openNew : undefined}
          addLabel="Convidar membro"
        />

      {/* Filtro por categoria (Membros / Guests / Externos) */}
      <div className="flex justify-end">
        <Select value={filter} onValueChange={(v) => v && setFilter(v as MemberFilter)}>
          <SelectTrigger className="w-[200px]">
            <SelectValue>
              {(value: string | null) => {
                const f = (value as MemberFilter) ?? "all";
                return `${MEMBER_FILTER_LABELS[f]} (${counts[f]})`;
              }}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            {(["all", "internal", "guest", "external"] as MemberFilter[]).map((f) => (
              <SelectItem key={f} value={f}>
                {MEMBER_FILTER_LABELS[f]} ({counts[f]})
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Mobile: cards */}
      <div className="md:hidden space-y-3">
        {visibleMembers.map((m) => (
          <MemberCardMobile
            key={m.id}
            m={m}
            isAdmin={isAdmin}
            canViewCapacity={canViewCapacity}
            onOpenSkills={() => setSkillSheetMemberId(m.id)}
            onEdit={() => openEdit(m)}
            onDelete={() => remove(m.id)}
          />
        ))}
        {visibleMembers.length === 0 && (
          <div className="surface p-8 text-center text-muted-foreground text-sm">
            {filter === "all"
              ? "Nenhum membro cadastrado."
              : `Nenhum ${MEMBER_FILTER_LABELS[filter].toLowerCase()} nessa categoria.`}
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
            {visibleMembers.map((m) => {
              const usage = m.fpCapacity > 0 ? m.fpPlannedWeek / m.fpCapacity : 0;
              return (
                <TableRow key={m.id}>
                  <TableCell className="font-medium">
                    {m.name}
                    {m.isGuest && (
                      <Badge variant="outline" className="ml-2 text-[10px] border-sky-400 text-sky-500">
                        Guest
                      </Badge>
                    )}
                    {m.isExternal && !m.isGuest && (
                      <Badge variant="outline" className="ml-2 text-[10px] border-orange-400 text-orange-500">
                        Externo
                      </Badge>
                    )}
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline">{positionLabel(m.position)}</Badge>
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-wrap items-center gap-1.5">
                      {m.primaryTower ? (
                        <Badge variant="secondary" className="text-xs">
                          {towerLabel(m.primaryTower)}
                        </Badge>
                      ) : (
                        <span className="text-xs text-muted-foreground/60">—</span>
                      )}
                      {m.fullstack && (
                        <Badge className="text-[10px] bg-amber-500/15 text-amber-600 border border-amber-500/30 hover:bg-amber-500/15">
                          <Star className="h-2.5 w-2.5 mr-1 fill-current" />
                          Fullstack
                        </Badge>
                      )}
                    </div>
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
                              {m.fpPlannedWeek}/{m.fpCapacity}
                              <span className="font-sans font-semibold text-[10px] tracking-[0.12em] uppercase ml-1">PFV</span>
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
                      {canViewCapacity && (
                        <Link href={`/members/${m.id}`}>
                          <Button variant="ghost" size="icon" title="Ver capacity detalhada">
                            <Gauge className="h-4 w-4" />
                          </Button>
                        </Link>
                      )}
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
            {visibleMembers.length === 0 && (
              <TableRow>
                <TableCell colSpan={5} className="text-center text-muted-foreground py-8">
                  {filter === "all"
                    ? "Nenhum membro cadastrado."
                    : `Nenhum ${MEMBER_FILTER_LABELS[filter].toLowerCase()} nessa categoria.`}
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
            const count = teamMembers.filter((m) => m.position === key).length;
            return (
              <DetailCard key={key} label={role.label} summary={role.summary} responsibilities={role.responsibilities} extra={role.suggestedCapacity} count={count} />
            );
          })}
        </div>
      </div>

      {/* ─── Torres de especialidade ─── */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold text-muted-foreground flex items-center gap-2">
            <Sparkles className="h-4 w-4" /> Torres de especialidade
          </h2>
          <span className="text-[10px] text-muted-foreground/70 uppercase tracking-wide hidden md:inline">
            Vem do Perfil de skills
          </span>
        </div>
        <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
          {TOWERS.map((tower) => (
            <TowerCard
              key={tower.key}
              tower={tower}
              members={teamMembers}
              onOpenSkills={(id) => setSkillSheetMemberId(id)}
            />
          ))}
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
                <Label>Cargo</Label>
                <Select
                  value={form.position}
                  onValueChange={(v) =>
                    v &&
                    setForm({
                      ...form,
                      position: v,
                      // Auto-suggest accessLevel from cargo, but only when the
                      // admin hasn't picked a non-derived value yet (i.e., it
                      // still matches the prior position's mapping).
                      accessLevel:
                        form.accessLevel ===
                        mapPositionToAccessLevel(form.position)
                          ? mapPositionToAccessLevel(v)
                          : form.accessLevel,
                    })
                  }
                >
                  <SelectTrigger>
                    <SelectValue>
                      {(value: string | null) => positionLabel(value)}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {POSITIONS.map((p) => (
                      <SelectItem key={p} value={p}>
                        {POSITION_LABELS[p]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-2">
                <Label>Nível de acesso</Label>
                <Select
                  value={form.accessLevel}
                  onValueChange={(v) =>
                    v && setForm({ ...form, accessLevel: v as AccessLevel })
                  }
                >
                  <SelectTrigger>
                    <SelectValue>
                      {(value: string | null) =>
                        value ? ACCESS_LEVEL_LABELS[value as AccessLevel] : "—"
                      }
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {MEMBER_ACCESS_LEVELS.map((al) => (
                      <SelectItem key={al} value={al}>
                        {ACCESS_LEVEL_LABELS[al]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <p className="text-[10px] text-muted-foreground">
              Cargo é o título do membro; nível de acesso controla o que ele pode
              fazer na plataforma. Por padrão sugerimos um nível baseado no
              cargo, mas você pode promover (ex: dar admin a um Principal Engineer).
            </p>
            <div className="grid gap-2">
              <Label>Especialidade declarada <span className="text-muted-foreground font-normal text-[10px]">(legacy — preenchido no onboarding)</span></Label>
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
            <div className="grid grid-cols-2 gap-4">
              <div className="grid gap-2">
                <Label>GitHub Username</Label>
                <Input value={form.githubUsername} onChange={(e) => setForm({ ...form, githubUsername: e.target.value })} />
              </div>
              <div className="grid gap-2">
                <Label>PFV Capacity por Sprint</Label>
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

      <ConfirmDialog state={confirmState} onClose={() => setConfirmState(null)} />
      </div>
    </PageContainer>
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

// ─── Tower Card (assessment-driven specialty cards) ──────────

type TowerRanked = { member: Member; score: number; isPrimary: boolean; refCount: number };

function TowerCard({
  tower,
  members,
  onOpenSkills,
}: {
  tower: Tower;
  members: Member[];
  onOpenSkills: (memberId: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);

  const Icon = (lucideIcons as Record<string, React.ComponentType<{ className?: string }>>)[tower.icon];

  const ranked: TowerRanked[] = members
    .map((m) => {
      const row = m.skills.find((s) => s.towerKey === tower.key);
      const score = row?.score ?? 0;
      const refCount = row
        ? Object.values(row.subskills ?? {}).filter((v) => v === "ref").length
        : 0;
      return { member: m, score, isPrimary: m.primaryTower === tower.key, refCount };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score);

  const atuantes = ranked.filter((x) => x.score >= 50);
  const referencias = ranked.filter((x) => x.score >= 85);

  return (
    <Card
      className="cursor-pointer hover:ring-foreground/10 transition-all"
      onClick={() => setExpanded(!expanded)}
    >
      <CardHeader className="pb-2">
        <div className="flex items-start justify-between gap-2">
          <CardTitle className="text-sm flex items-center gap-2 min-w-0">
            {Icon && <Icon className="h-4 w-4 text-foreground shrink-0" />}
            <span className="truncate">{tower.label}</span>
          </CardTitle>
          <div className="flex items-center gap-2 shrink-0">
            {atuantes.length > 0 && (
              <Badge variant="secondary" className="text-[10px]">
                {atuantes.length} atuante{atuantes.length > 1 ? "s" : ""}
              </Badge>
            )}
            {referencias.length > 0 && (
              <Badge className="text-[10px] bg-amber-500/15 text-amber-600 border border-amber-500/30 hover:bg-amber-500/15">
                <Star className="h-2.5 w-2.5 mr-1 fill-current" />
                {referencias.length}
              </Badge>
            )}
            {expanded ? (
              <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
            ) : (
              <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
            )}
          </div>
        </div>
        <p className="text-xs text-muted-foreground leading-relaxed">{tower.summary}</p>
      </CardHeader>

      {expanded && (
        <CardContent className="pt-0 space-y-4">
          {/* Subskills */}
          <div>
            <PixelHud size="xs" tone="muted">Subhabilidades</PixelHud>
            <ul className="mt-1.5 grid gap-1">
              {tower.subskills.map((sub) => (
                <li
                  key={sub.key}
                  className="text-xs text-muted-foreground flex items-start gap-1.5"
                >
                  <span className="text-muted-foreground/50 mt-0.5">•</span>
                  <span>{sub.label}</span>
                </li>
              ))}
            </ul>
          </div>

          {/* Members atuantes na torre */}
          <div>
            <PixelHud size="xs" tone="muted">Quem atua</PixelHud>
            {ranked.length === 0 ? (
              <p className="text-xs text-muted-foreground/70 italic mt-1.5">
                Nenhum membro avaliado nessa torre ainda.
              </p>
            ) : (
              <ul className="mt-1.5 space-y-0.5">
                {ranked.map(({ member, score, isPrimary, refCount }) => {
                  const tone = pixelTone(score, "skill");
                  return (
                    <li key={member.id}>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          onOpenSkills(member.id);
                        }}
                        className="w-full grid items-center gap-2 py-1 px-1.5 rounded hover:bg-muted/50 text-left"
                        style={{ gridTemplateColumns: "1fr auto auto" }}
                      >
                        <span className="text-xs truncate flex items-center gap-1.5">
                          {isPrimary && (
                            <Star
                              className="h-2.5 w-2.5 fill-amber-500 text-amber-500 shrink-0"
                              aria-label="Torre primária"
                            />
                          )}
                          <span className="truncate">{member.name}</span>
                          {refCount > 0 && (
                            <span
                              className="inline-flex items-center text-[9px] font-mono tabular-nums text-amber-600"
                              title={`Referência em ${refCount} subhabilidade${refCount > 1 ? "s" : ""}`}
                            >
                              ref·{refCount}
                            </span>
                          )}
                        </span>
                        <span
                          className="font-sans font-semibold text-[9px] tracking-[0.12em] uppercase leading-none"
                          style={{ color: tone.fg }}
                        >
                          {scoreLabel(score)}
                        </span>
                        <span
                          className="font-mono text-xs tabular-nums leading-none w-7 text-right"
                          style={{ color: tone.fg }}
                        >
                          {score}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </CardContent>
      )}
    </Card>
  );
}
