"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Clock,
  AlertCircle,
  UserX,
  FolderKanban,
  CheckCircle2,
  Pencil,
  SlidersHorizontal,
} from "lucide-react";
import {
  ResponsiveSheet,
  ResponsiveSheetContent,
  ResponsiveSheetHeader,
  ResponsiveSheetTitle,
  ResponsiveSheetBody,
} from "@/components/ui/responsive-sheet";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuCheckboxItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Markdown } from "@/components/ui/markdown";
import { StatusChip } from "@/components/ui/status-chip";
import { lookupChip, PROJECT_PHASE, PROJECT_ENGAGEMENT } from "@/lib/status-chips";
import { fmtDate } from "@/lib/date-utils";
import { cn } from "@/lib/utils";
import { useIsMobile } from "@/hooks/use-mobile";
import { createClient } from "@/lib/supabase/client";
import { showErrorToast } from "@/lib/optimistic/toast";
import {
  ProjectEditSheet,
  type ProjectEditInitial,
} from "@/components/projects/project-edit-sheet";
import type {
  ProjectOverview,
  ProjectCategory,
  ProjectHealth,
  ProjectTeamMember,
} from "@/lib/dal/project-overview";

// ─── Vocabulary ───────────────────────────────────────────

const CATEGORY_ORDER: ProjectCategory[] = ["billable", "non_billable", "internal"];

const CATEGORY_LABEL: Record<ProjectCategory, string> = {
  billable: "Billable",
  non_billable: "Não-billable",
  internal: "Internos",
};

const HEALTH_DOT: Record<ProjectHealth, string> = {
  red: "bg-red-500",
  amber: "bg-yellow-500",
  green: "bg-green-500",
};

const HEALTH_RING: Record<ProjectHealth, string> = {
  red: "shadow-[0_0_0_3px_rgba(239,68,68,0.15)]",
  amber: "shadow-[0_0_0_3px_rgba(234,179,8,0.15)]",
  green: "shadow-[0_0_0_3px_rgba(34,197,94,0.12)]",
};

// Ordem + rótulo das notes tipadas do PM Review no sheet.
const KIND_ORDER = [
  "summary",
  "project_direction",
  "risk",
  "need",
  "open_decision",
  "next_step",
  "team_signal",
] as const;

const KIND_META: Record<string, { label: string; dot: string }> = {
  summary: { label: "Panorama", dot: "bg-muted-foreground" },
  project_direction: { label: "Rumo", dot: "bg-blue-500" },
  risk: { label: "Risco", dot: "bg-red-500" },
  need: { label: "Precisa", dot: "bg-yellow-500" },
  open_decision: { label: "Decisão aberta", dot: "bg-yellow-500" },
  next_step: { label: "Próximo", dot: "bg-green-500" },
  team_signal: { label: "Time", dot: "bg-purple-500" },
};

// ─── Helpers ──────────────────────────────────────────────

/** Frase curta de sinal pro card compacto. */
function primarySignal(p: ProjectOverview): { text: string; tone: "red" | "amber" | "muted" } {
  if (p.signals.overdue > 0)
    return { text: `${p.signals.overdue} vencida${p.signals.overdue > 1 ? "s" : ""}`, tone: "red" };
  const riskCount = p.pmReview?.notesByKind.risk?.length ?? 0;
  if (riskCount > 0)
    return { text: `${riskCount} risco${riskCount > 1 ? "s" : ""} no PM Review`, tone: "red" };
  if (p.signals.blocked > 0)
    return { text: `${p.signals.blocked} parada${p.signals.blocked > 1 ? "s" : ""} +3d`, tone: "amber" };
  if (p.signals.unassigned > 0)
    return { text: `${p.signals.unassigned} sem dono`, tone: "amber" };
  return { text: "Sem pendências", tone: "muted" };
}

/** "Contínuo" ou "Fim ~ DD/MM" — leitura de horizonte do projeto. */
function horizonLabel(p: ProjectOverview): string {
  if (p.engagementType === "continuous") return "Contínuo";
  return p.endDate ? `Fim ~ ${fmtDate(new Date(p.endDate))}` : "Sem prazo definido";
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/);
  return ((parts[0]?.[0] ?? "") + (parts.length > 1 ? parts[parts.length - 1][0] : "")).toUpperCase();
}

/** Stack compacto de iniciais do time, com overflow +N. */
function TeamStack({ team, max = 4 }: { team: ProjectTeamMember[]; max?: number }) {
  if (team.length === 0) return null;
  const shown = team.slice(0, max);
  const overflow = team.length - shown.length;
  return (
    <div className="flex items-center -space-x-1.5">
      {shown.map((m) => (
        <span
          key={m.id}
          title={m.name}
          className="flex h-5 w-5 items-center justify-center rounded-full border border-background bg-muted text-[9px] font-medium text-muted-foreground"
        >
          {initials(m.name)}
        </span>
      ))}
      {overflow > 0 && (
        <span className="flex h-5 w-5 items-center justify-center rounded-full border border-background bg-muted text-[9px] font-medium text-muted-foreground">
          +{overflow}
        </span>
      )}
    </div>
  );
}

// ─── Card ─────────────────────────────────────────────────

function ProjectCard({ p, onClick }: { p: ProjectOverview; onClick: () => void }) {
  const sig = primarySignal(p);
  return (
    <button
      type="button"
      onClick={onClick}
      className="surface w-full text-left p-4 transition-colors hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <div className="flex items-start gap-2.5">
        <span
          className={cn("mt-1 h-2.5 w-2.5 shrink-0 rounded-full", HEALTH_DOT[p.health], HEALTH_RING[p.health])}
        />
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline justify-between gap-2">
            <h3 className="truncate text-sm font-semibold">{p.name}</h3>
            <StatusChip {...lookupChip(PROJECT_PHASE, p.phase)} size="sm" className="shrink-0" />
          </div>
          <p className="mt-0.5 truncate text-xs text-muted-foreground">
            {p.clientName ?? "—"}
            {p.pmName ? ` · PM ${p.pmName}` : ""}
          </p>
        </div>
      </div>

      {/* Horizonte + time */}
      <div className="mt-2.5 flex items-center justify-between gap-2">
        <span
          className={cn(
            "truncate text-[11px]",
            p.engagementType === "continuous" ? "text-primary" : "text-muted-foreground",
          )}
        >
          {horizonLabel(p)}
        </span>
        <TeamStack team={p.team} />
      </div>

      {/* Sprint */}
      {p.sprint ? (
        <div className="mt-3">
          <div className="flex items-center justify-between text-[11px] text-muted-foreground">
            <span className="truncate">{p.sprint.name}</span>
            <span className="tabular-nums">
              {p.sprint.done}/{p.sprint.planned} FP · {p.sprint.pct}%
            </span>
          </div>
          <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-muted">
            <div
              className={cn("h-full rounded-full", p.sprint.loadPct > 1 ? "bg-red-500" : "bg-primary")}
              style={{ width: `${Math.min(100, p.sprint.pct)}%` }}
            />
          </div>
        </div>
      ) : (
        <p className="mt-3 text-[11px] text-muted-foreground">Sem sprint nesta semana</p>
      )}

      {/* Sinal primário */}
      <p
        className={cn(
          "mt-2 text-xs",
          sig.tone === "red" && "text-red-400",
          sig.tone === "amber" && "text-yellow-500",
          sig.tone === "muted" && "text-muted-foreground",
        )}
      >
        {sig.text}
      </p>
    </button>
  );
}

// ─── Detalhe (compartilhado entre sheet mobile + painel desktop) ──

/** Cabeçalho do detalhe. `inSheet` ajusta o tipo do título e o gap do X. */
function ProjectHeaderRow({
  p,
  onEdit,
  inSheet,
}: {
  p: ProjectOverview;
  onEdit: () => void;
  inSheet: boolean;
}) {
  return (
    <>
      <div className="flex items-center gap-2.5">
        <span className={cn("h-2.5 w-2.5 shrink-0 rounded-full", HEALTH_DOT[p.health])} />
        {inSheet ? (
          <ResponsiveSheetTitle className="truncate">{p.name}</ResponsiveSheetTitle>
        ) : (
          <h2 className="truncate text-lg font-semibold">{p.name}</h2>
        )}
        <Button
          variant="ghost"
          size="sm"
          onClick={onEdit}
          className={cn("ml-auto shrink-0 gap-1.5 text-muted-foreground", inSheet && "mr-8")}
        >
          <Pencil className="h-3.5 w-3.5" />
          Editar
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">
        {CATEGORY_LABEL[p.category]}
        {p.clientName ? ` · ${p.clientName}` : ""}
        {p.pmName ? ` · PM ${p.pmName}` : ""}
      </p>
      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        <StatusChip {...lookupChip(PROJECT_PHASE, p.phase)} size="sm" />
        <StatusChip {...lookupChip(PROJECT_ENGAGEMENT, p.engagementType)} size="sm" />
        {p.engagementType === "fixed_scope" && (
          <span className="text-[11px] text-muted-foreground">{horizonLabel(p)}</span>
        )}
      </div>
    </>
  );
}

/** Corpo do detalhe: Time + Sinais + PM Review. Agnóstico de container. */
function ProjectDetailBody({ p }: { p: ProjectOverview }) {
  const notes = p.pmReview?.notesByKind ?? {};
  const orderedKinds = KIND_ORDER.filter((k) => (notes[k]?.length ?? 0) > 0);

  return (
    <>
      {/* Time */}
      {p.team.length > 0 && (
        <section>
          <h4 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Time ({p.team.length})
          </h4>
          <div className="flex flex-wrap gap-1.5">
            {p.team.map((m) => (
              <span key={m.id} className="surface-inset px-2 py-1 text-xs">
                {m.name}
                {m.position ? <span className="ml-1 text-muted-foreground">{m.position}</span> : null}
              </span>
            ))}
          </div>
        </section>
      )}

      {/* Sinais */}
      <section>
        <h4 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Sinais
        </h4>
        <div className="grid grid-cols-3 gap-2">
          <SignalStat icon={Clock} label="Vencidas" value={p.signals.overdue} tone="red" />
          <SignalStat icon={AlertCircle} label="Paradas +3d" value={p.signals.blocked} tone="amber" />
          <SignalStat icon={UserX} label="Sem dono" value={p.signals.unassigned} tone="amber" />
        </div>
        {p.sprint && (
          <p className="mt-2 text-xs text-muted-foreground">
            {p.sprint.name} — {p.sprint.done}/{p.sprint.planned} FP entregues · carga{" "}
            {Math.round(p.sprint.loadPct * 100)}% da capacidade ({p.sprint.capacity} FP)
          </p>
        )}
      </section>

      {/* PM Review */}
      <section>
        <h4 className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          PM Review
          {p.pmReview && (
            <span className="font-normal normal-case text-muted-foreground/80">
              · semana {fmtDate(new Date(p.pmReview.referenceWeek))}
              {p.pmReview.isCurrentWeek ? "" : " (última)"}
            </span>
          )}
        </h4>

        {!p.pmReview ? (
          <p className="text-sm text-muted-foreground">Sem PM Review registrado.</p>
        ) : (
          <>
            {orderedKinds.length > 0 ? (
              <ul className="space-y-2">
                {orderedKinds.map((kind) =>
                  (notes[kind] ?? []).map((n, i) => (
                    <li key={`${kind}-${i}`} className="surface-inset flex gap-2.5 p-2.5">
                      <span className={cn("mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full", KIND_META[kind]?.dot)} />
                      <div className="min-w-0">
                        <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                          {KIND_META[kind]?.label ?? kind}
                        </span>
                        <p className="text-sm">{n.content}</p>
                      </div>
                    </li>
                  )),
                )}
              </ul>
            ) : (
              <p className="text-sm text-muted-foreground">Sem notes nesta semana.</p>
            )}

            {p.pmReview.reportMarkdown && (
              <details className="mt-3 group">
                <summary className="cursor-pointer text-xs font-semibold uppercase tracking-wider text-muted-foreground hover:text-foreground">
                  Report completo (Vitoria)
                </summary>
                <div className="mt-2">
                  <Markdown>{p.pmReview.reportMarkdown}</Markdown>
                </div>
              </details>
            )}
          </>
        )}
      </section>
    </>
  );
}

/** Wrapper mobile — detalhe dentro de uma ResponsiveSheet. */
function ProjectSheet({ p, onEdit }: { p: ProjectOverview; onEdit: () => void }) {
  return (
    <>
      <ResponsiveSheetHeader>
        <ProjectHeaderRow p={p} onEdit={onEdit} inSheet />
      </ResponsiveSheetHeader>
      <ResponsiveSheetBody className="space-y-5">
        <ProjectDetailBody p={p} />
      </ResponsiveSheetBody>
    </>
  );
}

/** Painel desktop — detalhe inline ao lado do side-nav. */
function ProjectDetailPanel({ p, onEdit }: { p: ProjectOverview; onEdit: () => void }) {
  return (
    <div className="surface p-5">
      <div className="border-b pb-4">
        <ProjectHeaderRow p={p} onEdit={onEdit} inSheet={false} />
      </div>
      <div className="space-y-5 pt-4">
        <ProjectDetailBody p={p} />
      </div>
    </div>
  );
}

/** Card compacto do side-nav desktop. */
function ProjectNavItem({
  p,
  active,
  onClick,
}: {
  p: ProjectOverview;
  active: boolean;
  onClick: () => void;
}) {
  const sig = primarySignal(p);
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "surface w-full p-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        active ? "border-primary/40 bg-primary/5" : "hover:bg-muted/40",
      )}
    >
      <div className="flex items-center gap-2">
        <span className={cn("h-2 w-2 shrink-0 rounded-full", HEALTH_DOT[p.health])} />
        <span className="truncate text-sm font-medium">{p.name}</span>
      </div>
      {p.sprint && (
        <div className="mt-2 h-1 w-full overflow-hidden rounded-full bg-muted">
          <div
            className={cn("h-full rounded-full", p.sprint.loadPct > 1 ? "bg-red-500" : "bg-primary")}
            style={{ width: `${Math.min(100, p.sprint.pct)}%` }}
          />
        </div>
      )}
      <p
        className={cn(
          "mt-1.5 truncate text-[11px]",
          sig.tone === "red" && "text-red-400",
          sig.tone === "amber" && "text-yellow-500",
          sig.tone === "muted" && "text-muted-foreground",
        )}
      >
        {sig.text}
      </p>
    </button>
  );
}

function SignalStat({
  icon: Icon,
  label,
  value,
  tone,
}: {
  icon: typeof Clock;
  label: string;
  value: number;
  tone: "red" | "amber";
}) {
  const active = value > 0;
  return (
    <div className="surface-inset p-2.5 text-center">
      <Icon
        className={cn(
          "mx-auto h-4 w-4",
          !active ? "text-muted-foreground/50" : tone === "red" ? "text-red-400" : "text-yellow-500",
        )}
      />
      <div className={cn("mt-1 text-lg font-bold tabular-nums", !active && "text-muted-foreground")}>
        {value}
      </div>
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
    </div>
  );
}

// ─── Big numbers ──────────────────────────────────────────

function BigStat({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone?: "amber" | "red";
}) {
  return (
    <div className="surface p-4">
      <div className="text-[11px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div
        className={cn(
          "mt-1 text-3xl font-bold tabular-nums",
          tone === "amber" && "text-yellow-500",
          tone === "red" && "text-red-400",
        )}
      >
        {value}
      </div>
    </div>
  );
}

// ─── Board ────────────────────────────────────────────────

export function ProjetosBoard({ projects }: { projects: ProjectOverview[] }) {
  const router = useRouter();
  const isMobile = useIsMobile();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showInternal, setShowInternal] = useState(false);
  const [showEval, setShowEval] = useState(false);
  const [editProject, setEditProject] = useState<ProjectEditInitial | null>(null);
  const [editOpen, setEditOpen] = useState(false);

  // ProjectOverview não carrega os campos de edição — busca o registro
  // completo sob demanda ao abrir o editor.
  async function openEdit(id: string) {
    const supabase = createClient();
    const { data, error } = await supabase
      .from("Project")
      .select(
        "id, name, repoUrl, startDate, endDate, status, category, phase, engagementType, clientId, pmId, githubRepoOwner, githubRepoName, githubDefaultBranch, projectMembers:ProjectMember(memberId)",
      )
      .eq("id", id)
      .single();
    if (error || !data) {
      showErrorToast(new Error(error?.message ?? "Projeto não encontrado"), {
        label: "Falha ao abrir editor",
      });
      return;
    }
    setEditProject({
      id: data.id,
      name: data.name,
      repoUrl: data.repoUrl,
      startDate: data.startDate,
      endDate: data.endDate,
      status: data.status,
      category: data.category ?? "billable",
      phase: data.phase ?? "ops",
      engagementType: data.engagementType ?? "fixed_scope",
      clientId: data.clientId,
      pmId: data.pmId,
      githubRepoOwner: data.githubRepoOwner,
      githubRepoName: data.githubRepoName,
      githubDefaultBranch: data.githubDefaultBranch,
      memberIds: (data.projectMembers ?? []).map((m: { memberId: string }) => m.memberId),
    });
    setEditOpen(true);
  }

  // Filtros vivem num dropdown no rodapé: internos e testes/eval ficam
  // escondidos por default (foco em projetos de cliente).
  const internalCount = useMemo(
    () => projects.filter((p) => p.category === "internal" && !p.isEval).length,
    [projects],
  );
  const evalCount = useMemo(() => projects.filter((p) => p.isEval).length, [projects]);

  // Big numbers — sempre sobre o universo de cliente (exclui internos + eval).
  const stats = useMemo(() => {
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const clientProjects = projects.filter((p) => p.category !== "internal" && !p.isEval);
    return {
      active: clientProjects.filter((p) => p.status === "active").length,
      newThisMonth: clientProjects.filter((p) => new Date(p.createdAt) >= monthStart).length,
      attention: clientProjects.filter((p) => p.status === "active" && p.health !== "green").length,
      pipeline: clientProjects.filter((p) => p.phase === "commercial").length,
    };
  }, [projects]);

  const grouped = useMemo(() => {
    const visible = projects.filter((p) => {
      if (p.isEval && !showEval) return false;
      if (p.category === "internal" && !showInternal) return false;
      return true;
    });
    return CATEGORY_ORDER.map((cat) => ({
      category: cat,
      items: visible.filter((p) => p.category === cat),
    })).filter((g) => g.items.length > 0);
  }, [projects, showInternal, showEval]);

  const visibleFlat = useMemo(() => grouped.flatMap((g) => g.items), [grouped]);

  // Clique explícito (mobile abre sheet; desktop fixa o painel).
  const explicitSelected = selectedId
    ? visibleFlat.find((p) => p.id === selectedId) ?? null
    : null;
  // Desktop sempre mostra algo: default no 1º projeto visível.
  const desktopSelected = explicitSelected ?? visibleFlat[0] ?? null;

  if (projects.length === 0) {
    return (
      <div className="surface flex flex-col items-center gap-2 py-12 text-center text-sm text-muted-foreground">
        <FolderKanban className="h-6 w-6" />
        Nenhum projeto ativo.
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Big numbers — leitura do portfólio de cliente */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <BigStat label="Projetos ativos" value={stats.active} />
        <BigStat label="Novos no mês" value={stats.newThisMonth} />
        <BigStat
          label="Em atenção"
          value={stats.attention}
          tone={stats.attention > 0 ? "amber" : undefined}
        />
        <BigStat label="Pipe comercial" value={stats.pipeline} />
      </div>

      {/* Mobile: grid de cards → abre sheet. Desktop: master-detail. */}
      {grouped.length > 0 &&
        (isMobile ? (
          grouped.map((g) => (
            <section key={g.category}>
              <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold">
                {CATEGORY_LABEL[g.category]}
                <span className="text-xs font-normal text-muted-foreground">({g.items.length})</span>
              </h2>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {g.items.map((p) => (
                  <ProjectCard key={p.id} p={p} onClick={() => setSelectedId(p.id)} />
                ))}
              </div>
            </section>
          ))
        ) : (
          <div className="grid grid-cols-[280px_1fr] items-start gap-4">
            <div className="space-y-4">
              {grouped.map((g) => (
                <div key={g.category} className="space-y-1.5">
                  <h3 className="px-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    {CATEGORY_LABEL[g.category]}{" "}
                    <span className="font-normal">({g.items.length})</span>
                  </h3>
                  {g.items.map((p) => (
                    <ProjectNavItem
                      key={p.id}
                      p={p}
                      active={p.id === desktopSelected?.id}
                      onClick={() => setSelectedId(p.id)}
                    />
                  ))}
                </div>
              ))}
            </div>
            {desktopSelected && (
              <ProjectDetailPanel
                key={desktopSelected.id}
                p={desktopSelected}
                onEdit={() => openEdit(desktopSelected.id)}
              />
            )}
          </div>
        ))}

      {grouped.length === 0 && (
        <div className="surface flex flex-col items-center gap-2 py-12 text-center text-sm text-muted-foreground">
          <CheckCircle2 className="h-6 w-6" />
          Nenhum projeto visível. Ajuste os filtros abaixo.
        </div>
      )}

      {/* Filtros — internos + testes/eval, escondidos por default */}
      {(internalCount > 0 || evalCount > 0) && (
        <div className="flex justify-end">
          <DropdownMenu>
            <DropdownMenuTrigger
              render={<Button variant="ghost" size="sm" className="gap-1.5 text-muted-foreground" />}
            >
              <SlidersHorizontal className="h-3.5 w-3.5" />
              Filtros
              {(showInternal || showEval) && (
                <span className="ml-1 rounded bg-primary/15 px-1.5 py-0.5 text-[10px] font-medium text-primary">
                  {(showInternal ? 1 : 0) + (showEval ? 1 : 0)}
                </span>
              )}
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuCheckboxItem
                checked={showInternal}
                onCheckedChange={(v) => setShowInternal(!!v)}
                disabled={internalCount === 0}
              >
                Mostrar internos ({internalCount})
              </DropdownMenuCheckboxItem>
              <DropdownMenuCheckboxItem
                checked={showEval}
                onCheckedChange={(v) => setShowEval(!!v)}
                disabled={evalCount === 0}
              >
                Mostrar testes/eval ({evalCount})
              </DropdownMenuCheckboxItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      )}

      {/* Detalhe mobile vive numa sheet; no desktop é o painel inline. */}
      <ResponsiveSheet
        open={isMobile && !!explicitSelected}
        onOpenChange={(o) => !o && setSelectedId(null)}
      >
        <ResponsiveSheetContent size="lg">
          {explicitSelected && (
            <ProjectSheet p={explicitSelected} onEdit={() => openEdit(explicitSelected.id)} />
          )}
        </ResponsiveSheetContent>
      </ResponsiveSheet>

      <ProjectEditSheet
        open={editOpen}
        onOpenChange={setEditOpen}
        project={editProject}
        onSaved={() => {
          setSelectedId(null);
          router.refresh();
        }}
      />
    </div>
  );
}
