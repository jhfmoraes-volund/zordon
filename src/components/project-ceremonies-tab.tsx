"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  CalendarClock,
  ChartLine,
  Link2,
  Play,
  Plus,
  Sparkles,
  StickyNote,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { ChipTone } from "@/lib/status-chips";
import { fmtDate as fmtShortDate } from "@/lib/date-utils";
import { fetchOrThrow, showErrorToast } from "@/lib/optimistic/toast";
import { toast } from "sonner";
import { PlanningSheet } from "@/components/planning/planning-sheet";
import { PMReviewSheet } from "@/components/pm-review/pm-review-sheet";

// ─── Tab Rituais (user-facing) ──────────────────────────────────────────
// Conceito user-facing: "Ritual" — engloba Planning + PM Review. No banco
// são entidades separadas (PlanningCeremony vs PMReview); a UI UNIFICA via
// `/api/projects/[id]/rituals` que retorna { items, featured, permissions }.
//
// Zonas:
//   • Featured — card fixo no topo com o último PM Review published ("sempre
//     consultado"). Some quando não há.
//   • Filters — Todas / Planning / PM Review.
//   • Lista — itens normalizados ordenados por data desc.

type PhasePlanning =
  | "idle"
  | "reading"
  | "proposing"
  | "approving"
  | "closed"
  | "archived";

type PMReviewStatus = "draft" | "published" | "archived";

type RitualPlanning = {
  kind: "planning";
  id: string;
  title: string;
  status: PhasePlanning;
  scheduledFor: string | null;
  sortKey: string;
  href: string;
  badges: { linkedCount: number; noteCount: number; pendingCount: number };
  facilitatorName: string | null;
  sprintName: string | null;
};

type RitualPMReview = {
  kind: "pm_review";
  id: string;
  title: string;
  status: PMReviewStatus;
  scheduledFor: string | null;
  referenceWeek: string;
  sortKey: string;
  href: string;
  badges: {
    linkedCount: number;
    noteCount: number;
    noteByKind: Partial<
      Record<
        | "summary"
        | "project_direction"
        | "next_step"
        | "risk"
        | "need"
        | "team_signal"
        | "open_decision",
        number
      >
    >;
    reportGenerated: boolean;
  };
  facilitatorName: string | null;
};

type RitualItem = RitualPlanning | RitualPMReview;

type RitualsResponse = {
  items: RitualItem[];
  featured: RitualPMReview | null;
  permissions: { canCreatePMReview: boolean };
};

const PLANNING_STATUS_LABEL: Record<PhasePlanning, string> = {
  idle: "Em planejamento",
  reading: "Em planejamento",
  proposing: "Em planejamento",
  approving: "Em planejamento",
  closed: "Concluída",
  archived: "Arquivada",
};

const PM_REVIEW_STATUS_LABEL: Record<PMReviewStatus, string> = {
  draft: "Rascunho",
  published: "Publicado",
  archived: "Arquivado",
};

function planningTone(p: PhasePlanning): ChipTone {
  if (p === "closed") return "green";
  if (p === "archived") return "muted";
  return "blue";
}

function pmReviewTone(s: PMReviewStatus): ChipTone {
  if (s === "published") return "green";
  if (s === "archived") return "muted";
  return "blue";
}

type FilterKey = "all" | "planning" | "pm_review";

const FILTERS: { key: FilterKey; label: string }[] = [
  { key: "all", label: "Todas" },
  { key: "planning", label: "Planning" },
  { key: "pm_review", label: "PM Review" },
];

type Props = {
  projectId: string;
  projectName: string;
  /** Manager-level — habilita criar Planning. */
  canManage?: boolean;
};

export function ProjectCeremoniesTab({
  projectId,
  projectName,
  canManage = false,
}: Props) {
  const router = useRouter();

  const [items, setItems] = useState<RitualItem[]>([]);
  const [featured, setFeatured] = useState<RitualPMReview | null>(null);
  const [canCreatePMReview, setCanCreatePMReview] = useState(false);

  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<FilterKey>("all");
  const [creatingPlanning, setCreatingPlanning] = useState(false);
  const [creatingPMReview, setCreatingPMReview] = useState(false);
  const [planningSheetOpen, setPlanningSheetOpen] = useState(false);
  const [pmReviewSheetOpen, setPMReviewSheetOpen] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch(`/api/projects/${projectId}/rituals`);
      if (!r.ok) {
        setItems([]);
        setFeatured(null);
        setCanCreatePMReview(false);
        return;
      }
      const data = (await r.json()) as RitualsResponse;
      setItems(data.items ?? []);
      setFeatured(data.featured ?? null);
      setCanCreatePMReview(data.permissions?.canCreatePMReview ?? false);
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    load();
  }, [load]);

  const counts = useMemo(() => {
    let planning = 0;
    let pmReview = 0;
    for (const it of items) {
      if (it.kind === "planning") planning++;
      else pmReview++;
    }
    return { all: items.length, planning, pm_review: pmReview };
  }, [items]);

  const visible = useMemo(() => {
    if (filter === "all") return items;
    return items.filter((i) => i.kind === filter);
  }, [items, filter]);

  async function handleCreatePlanning(sprintId: string | null) {
    if (creatingPlanning) return;
    setCreatingPlanning(true);
    try {
      const res = await fetchOrThrow("/api/planning", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId, sprintId }),
      });
      const created = (await res.json()) as { id: string };
      setPlanningSheetOpen(false);
      toast.success("Planning criada.");
      router.push(`/rituals/${created.id}`);
    } catch (err) {
      showErrorToast(err, { label: "Falha ao criar Planning" });
    } finally {
      setCreatingPlanning(false);
    }
  }

  async function handleCreatePMReview(
    referenceWeek: string,
    facilitatorId: string | null,
  ) {
    if (creatingPMReview) return;
    setCreatingPMReview(true);
    try {
      const res = await fetchOrThrow("/api/pm-review", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId, referenceWeek, facilitatorId }),
      });
      const created = (await res.json()) as { id: string };
      setPMReviewSheetOpen(false);
      toast.success("PM Review criado.");
      router.push(`/pm-reviews/${created.id}`);
    } catch (err) {
      showErrorToast(err, { label: "Falha ao criar PM Review" });
    } finally {
      setCreatingPMReview(false);
    }
  }

  return (
    <div className="space-y-3">
      {/* Zona 1 — Featured PM Review da semana */}
      {featured && (
        <Link
          href={featured.href}
          className="block rounded-lg border bg-gradient-to-br from-violet-50 to-violet-100/40 p-4 transition-colors hover:bg-violet-100/60 dark:from-violet-950/30 dark:to-violet-900/10 dark:hover:bg-violet-950/50"
        >
          <div className="flex items-start gap-3">
            <ChartLine className="mt-0.5 h-5 w-5 shrink-0 text-violet-600 dark:text-violet-300" />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold">{featured.title}</p>
              <p className="mt-0.5 truncate text-xs text-muted-foreground">
                {featured.badges.reportGenerated
                  ? "Report disponível"
                  : "Aguardando síntese"}
                {featured.badges.noteCount > 0 && (
                  <>
                    {" · "}
                    {featured.badges.noteCount} nota
                    {featured.badges.noteCount > 1 ? "s" : ""}
                  </>
                )}
                {featured.badges.noteByKind.risk && (
                  <>
                    {" · "}
                    {featured.badges.noteByKind.risk} risco
                    {(featured.badges.noteByKind.risk ?? 0) > 1 ? "s" : ""}
                  </>
                )}
                {featured.badges.noteByKind.next_step && (
                  <>
                    {" · "}
                    {featured.badges.noteByKind.next_step} próximo passo
                    {(featured.badges.noteByKind.next_step ?? 0) > 1 ? "s" : ""}
                  </>
                )}
              </p>
            </div>
            <Button size="sm" variant="ghost" className="shrink-0">
              <Sparkles className="size-3.5" /> Abrir report
            </Button>
          </div>
        </Link>
      )}

      {/* Zona 2 — Filtros + ações */}
      <div className="flex flex-wrap items-center gap-2">
        <div
          role="tablist"
          aria-label="Filtrar rituais"
          className="inline-flex rounded-md border bg-muted/30 p-0.5 text-sm"
        >
          {FILTERS.map((f) => {
            const active = filter === f.key;
            return (
              <button
                key={f.key}
                role="tab"
                type="button"
                aria-selected={active}
                onClick={() => setFilter(f.key)}
                className={cn(
                  "rounded-sm px-2.5 py-1 text-xs transition-colors",
                  active
                    ? "bg-background text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {f.label}
                <span className="ml-1.5 font-mono text-[10px] tabular-nums text-muted-foreground">
                  {counts[f.key]}
                </span>
              </button>
            );
          })}
        </div>
        <div className="ml-auto flex items-center gap-2">
          {canManage && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => setPlanningSheetOpen(true)}
              disabled={creatingPlanning}
            >
              <Plus className="size-3.5" />
              {creatingPlanning ? "Criando…" : "Nova Planning"}
            </Button>
          )}
          {canCreatePMReview && (
            <Button
              size="sm"
              onClick={() => setPMReviewSheetOpen(true)}
              disabled={creatingPMReview}
            >
              <Plus className="size-3.5" />
              {creatingPMReview ? "Criando…" : "Novo PM Review"}
            </Button>
          )}
        </div>
      </div>

      {/* Zona 3 — Lista */}
      {loading ? (
        <p className="px-1 py-8 text-center text-sm text-muted-foreground">
          Carregando…
        </p>
      ) : visible.length === 0 ? (
        <div className="py-12 text-center text-muted-foreground">
          <CalendarClock className="mx-auto mb-2 h-8 w-8 opacity-50" />
          <p>Nenhum ritual em {projectName}.</p>
          {(canManage || canCreatePMReview) && (
            <p className="text-sm">Crie o primeiro ritual pra começar.</p>
          )}
        </div>
      ) : (
        <ul className="divide-y rounded-md border bg-card">
          {visible.map((it) => (
            <RitualRow key={`${it.kind}:${it.id}`} item={it} />
          ))}
        </ul>
      )}

      <PlanningSheet
        open={planningSheetOpen}
        onOpenChange={setPlanningSheetOpen}
        projectId={projectId}
        onCreate={handleCreatePlanning}
        saving={creatingPlanning}
      />

      <PMReviewSheet
        open={pmReviewSheetOpen}
        onOpenChange={setPMReviewSheetOpen}
        projectId={projectId}
        onCreate={handleCreatePMReview}
        saving={creatingPMReview}
      />
    </div>
  );
}

// ─── Row ───────────────────────────────────────────────────────────────

// ─── Identidade visual por tipo ─────────────────────────────────────────
// Planning = azul (action / planejamento); PM Review = violeta (síntese,
// coerente com o featured card). Aplicado em 3 lugares: borda lateral, caixa
// do ícone, chip de tipo.
const KIND_VISUAL = {
  planning: {
    label: "Planning",
    Icon: CalendarClock,
    iconBox:
      "bg-sky-50 text-sky-700 ring-sky-200 dark:bg-sky-950/40 dark:text-sky-300 dark:ring-sky-900/50",
    chip:
      "border-sky-200 bg-sky-50 text-sky-700 dark:border-sky-900/60 dark:bg-sky-950/40 dark:text-sky-300",
  },
  pm_review: {
    label: "PM Review",
    Icon: ChartLine,
    iconBox:
      "bg-violet-50 text-violet-700 ring-violet-200 dark:bg-violet-950/40 dark:text-violet-300 dark:ring-violet-900/50",
    chip:
      "border-violet-200 bg-violet-50 text-violet-700 dark:border-violet-900/60 dark:bg-violet-950/40 dark:text-violet-300",
  },
} as const;

// Tira o prefixo redundante do título — o chip de tipo já carrega isso.
function cleanTitle(item: RitualItem): string {
  if (item.kind === "planning") {
    return item.title.replace(/^Planning(\s*·\s*)?/, "").trim() || "—";
  }
  return item.title.replace(/^PM Review(\s*·\s*)?/, "").trim() || "—";
}

const STATUS_TONE_CLASS: Record<ChipTone, string> = {
  green: "text-emerald-700 dark:text-emerald-400",
  blue: "text-sky-700 dark:text-sky-300",
  muted: "text-muted-foreground",
  amber: "text-amber-700 dark:text-amber-500",
  red: "text-red-700 dark:text-red-400",
  purple: "text-violet-700 dark:text-violet-300",
  cyan: "text-cyan-700 dark:text-cyan-300",
  teal: "text-teal-700 dark:text-teal-300",
  pink: "text-pink-700 dark:text-pink-300",
  slate: "text-slate-700 dark:text-slate-300",
  brand: "text-primary",
};

const STATUS_DOT_BG: Record<ChipTone, string> = {
  green: "bg-emerald-500",
  blue: "bg-sky-500",
  muted: "bg-muted-foreground/60",
  amber: "bg-amber-500",
  red: "bg-red-500",
  purple: "bg-violet-500",
  cyan: "bg-cyan-500",
  teal: "bg-teal-500",
  pink: "bg-pink-500",
  slate: "bg-slate-500",
  brand: "bg-primary",
};

function RitualRow({ item }: { item: RitualItem }) {
  const tone =
    item.kind === "planning"
      ? planningTone(item.status)
      : pmReviewTone(item.status);
  const label =
    item.kind === "planning"
      ? PLANNING_STATUS_LABEL[item.status]
      : PM_REVIEW_STATUS_LABEL[item.status];

  const visual = KIND_VISUAL[item.kind];
  const Icon = visual.Icon;
  const title = cleanTitle(item);

  return (
    <li className="group flex items-center gap-3 px-3 py-2.5 transition-colors hover:bg-accent/40 focus-within:bg-accent/40">
      <span
        aria-hidden
        className={cn(
          "inline-flex size-8 shrink-0 items-center justify-center rounded-md ring-1 ring-inset",
          visual.iconBox,
        )}
      >
        <Icon className="size-4" />
      </span>
      <Link
        href={item.href}
        className="min-w-0 flex-1 focus-visible:outline-none"
      >
        <div className="flex items-center gap-2">
          <span
            className={cn(
              "inline-flex shrink-0 items-center rounded-sm border px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider",
              visual.chip,
            )}
          >
            {visual.label}
          </span>
          <p className="truncate text-sm font-medium">
            {title}
            {item.scheduledFor && (
              <span className="ml-1 font-normal text-muted-foreground">
                · {fmtShortDate(item.scheduledFor)}
              </span>
            )}
          </p>

          {item.badges.linkedCount > 0 && (
            <span
              title={`${item.badges.linkedCount} insumo(s) linkado(s)`}
              className="inline-flex shrink-0 items-center gap-0.5 rounded-sm border border-sky-200 bg-sky-50 px-1.5 py-0.5 text-[9px] font-medium text-sky-700 dark:border-sky-900/50 dark:bg-sky-950/40 dark:text-sky-300"
            >
              <Link2 className="size-2.5" />
              {item.badges.linkedCount}
            </span>
          )}

          {item.badges.noteCount > 0 && (
            <span
              title={`${item.badges.noteCount} nota(s)`}
              className="inline-flex shrink-0 items-center gap-0.5 rounded-sm border border-border bg-muted/50 px-1.5 py-0.5 text-[9px] font-medium text-muted-foreground"
            >
              <StickyNote className="size-2.5" />
              {item.badges.noteCount}
            </span>
          )}

          {item.kind === "planning" && item.badges.pendingCount > 0 && (
            <span
              title={`${item.badges.pendingCount} ação(ões) pendente(s)`}
              className="inline-flex shrink-0 items-center gap-1 text-[10px] font-medium text-amber-700 dark:text-amber-500"
            >
              <AlertTriangle className="size-2.5" />
              {item.badges.pendingCount}
            </span>
          )}

          {item.kind === "pm_review" && item.badges.reportGenerated && (
            <span
              title="Report sintetizado"
              className="inline-flex shrink-0 items-center gap-0.5 text-[10px] font-medium text-emerald-700 dark:text-emerald-400"
            >
              <Sparkles className="size-2.5" /> report
            </span>
          )}

          <span
            className={cn(
              "ml-auto hidden items-center gap-1 text-[10px] font-medium uppercase tracking-wider sm:inline-flex",
              STATUS_TONE_CLASS[tone],
            )}
          >
            <span
              aria-hidden
              className={cn("size-1.5 rounded-full", STATUS_DOT_BG[tone])}
            />
            {label}
          </span>
        </div>
        <p className="mt-0.5 truncate text-xs text-muted-foreground">
          {item.facilitatorName
            ? `Facilitador: ${item.facilitatorName}`
            : "Sem facilitador definido"}
        </p>
      </Link>
      <Link
        href={item.href}
        aria-label="Abrir"
        onClick={(e) => e.stopPropagation()}
        className="inline-flex size-6 shrink-0 items-center justify-center rounded-md bg-primary text-primary-foreground transition-colors hover:bg-primary/85 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
      >
        <Play className="size-3 fill-current" />
      </Link>
    </li>
  );
}
