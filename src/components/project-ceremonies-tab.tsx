"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  CalendarClock,
  ChartLine,
  CheckCircle2,
  FileEdit,
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
import { fetchOrThrow, showErrorToast, HttpError } from "@/lib/optimistic/toast";
import { toast } from "sonner";
import { PlanningSheet } from "@/components/planning/planning-sheet";
import { PMReviewSheet } from "@/components/pm-review/pm-review-sheet";
import { ReleasePlanningSheet } from "@/components/planning-session/release-planning-sheet";
import {
  RitualPickerModal,
  type RitualType,
} from "@/components/ceremonies/ritual-picker-modal";

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

type ReleaseStatus =
  | "draft"
  | "orchestrating"
  | "in-review"
  | "approved"
  | "aborted"
  | "error";

type RitualPlanning = {
  kind: "planning";
  id: string;
  title: string;
  status: PhasePlanning;
  scheduledFor: string | null;
  sortKey: string;
  href: string;
  badges: { linkedCount: number; noteCount: number; pendingCount: number };
  facilitatorId: string | null;
  facilitatorName: string | null;
  sprintId: string | null;
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
  facilitatorId: string | null;
  facilitatorName: string | null;
};

type RitualReleasePlanning = {
  kind: "release_planning";
  id: string;
  title: string;
  status: ReleaseStatus;
  scheduledFor: string | null;
  sprintCount: number;
  sortKey: string;
  href: string;
  badges: { linkedCount: number; noteCount: number };
  facilitatorId: string | null;
  facilitatorName: string | null;
};

type RitualItem = RitualPlanning | RitualPMReview | RitualReleasePlanning;

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

const RELEASE_STATUS_LABEL: Record<ReleaseStatus, string> = {
  draft: "Rascunho",
  orchestrating: "Orquestrando",
  "in-review": "Em revisão",
  approved: "Aprovado",
  aborted: "Abortado",
  error: "Erro",
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

function releaseTone(s: ReleaseStatus): ChipTone {
  if (s === "approved") return "green";
  if (s === "error" || s === "aborted") return "muted";
  return "blue";
}

type FilterKey = "all" | "planning" | "pm_review" | "release_planning";

const FILTERS: { key: FilterKey; label: string }[] = [
  { key: "all", label: "Todas" },
  { key: "planning", label: "Sprint Planning" },
  { key: "release_planning", label: "Release Planning" },
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
  const [canCreatePMReview, setCanCreatePMReview] = useState(false);

  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<FilterKey>("all");
  const [creatingPlanning, setCreatingPlanning] = useState(false);
  const [creatingPMReview, setCreatingPMReview] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [planningSheetOpen, setPlanningSheetOpen] = useState(false);
  const [pmReviewSheetOpen, setPMReviewSheetOpen] = useState(false);
  const [releaseSheetOpen, setReleaseSheetOpen] = useState(false);
  const [creatingRelease, setCreatingRelease] = useState(false);
  const [editingPlanning, setEditingPlanning] = useState<RitualPlanning | null>(
    null,
  );
  const [editingPMReview, setEditingPMReview] = useState<RitualPMReview | null>(
    null,
  );
  const [editingRelease, setEditingRelease] =
    useState<RitualReleasePlanning | null>(null);

  const handleEdit = useCallback(
    (item: RitualItem) => {
      if (item.kind === "planning") {
        setEditingPlanning(item);
        setPlanningSheetOpen(true);
      } else if (item.kind === "pm_review") {
        setEditingPMReview(item);
        setPMReviewSheetOpen(true);
      } else {
        setEditingRelease(item);
        setReleaseSheetOpen(true);
      }
    },
    [],
  );

  const handlePickRitual = useCallback(
    (type: RitualType) => {
      if (type === "pm_review") setPMReviewSheetOpen(true);
      else if (type === "sprint_planning") setPlanningSheetOpen(true);
      else {
        // Release Planning: criação explícita via sheet (não auto-create).
        setEditingRelease(null);
        setReleaseSheetOpen(true);
      }
    },
    [],
  );

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch(`/api/projects/${projectId}/rituals`);
      if (!r.ok) {
        setItems([]);
        setCanCreatePMReview(false);
        return;
      }
      const data = (await r.json()) as RitualsResponse;
      setItems(data.items ?? []);
      setCanCreatePMReview(data.permissions?.canCreatePMReview ?? false);
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- intentional initial load on mount
    void load();
  }, [load]);

  const counts = useMemo(() => {
    let planning = 0;
    let pmReview = 0;
    let release = 0;
    for (const it of items) {
      if (it.kind === "planning") planning++;
      else if (it.kind === "release_planning") release++;
      else pmReview++;
    }
    return {
      all: items.length,
      planning,
      release_planning: release,
      pm_review: pmReview,
    };
  }, [items]);

  const visible = useMemo(() => {
    if (filter === "all") return items;
    return items.filter((i) => i.kind === filter);
  }, [items, filter]);

  const { published, staging } = useMemo(() => {
    const pub: RitualItem[] = [];
    const stg: RitualItem[] = [];
    for (const it of visible) {
      const isPublished =
        it.kind === "planning"
          ? it.status === "closed" || it.status === "archived"
          : it.kind === "release_planning"
            ? it.status === "approved"
            : it.status === "published" || it.status === "archived";
      (isPublished ? pub : stg).push(it);
    }
    return { published: pub, staging: stg };
  }, [visible]);

  async function handleCreatePlanning(input: {
    sprintId: string | null;
    facilitatorId: string | null;
    scheduledFor: string | null;
  }) {
    if (creatingPlanning) return;
    setCreatingPlanning(true);
    try {
      const res = await fetchOrThrow("/api/planning", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId, ...input }),
      });
      const created = (await res.json()) as { id: string };
      setPlanningSheetOpen(false);
      toast.success("Planning criada.");
      router.push(`/rituals/${created.id}`);
    } catch (err) {
      // "1 planning viva por sprint": já existe uma ativa pra essa sprint →
      // abre a existente em vez de mostrar erro.
      if (err instanceof HttpError && err.status === 409 && err.body) {
        try {
          const { existingPlanningId } = JSON.parse(err.body) as {
            existingPlanningId?: string;
          };
          if (existingPlanningId) {
            setPlanningSheetOpen(false);
            toast.info("Já existe uma planning pra essa sprint — abrindo…");
            router.push(`/rituals/${existingPlanningId}`);
            return;
          }
        } catch {
          // body não-JSON → cai no erro genérico abaixo
        }
      }
      showErrorToast(err, { label: "Falha ao criar Planning" });
    } finally {
      setCreatingPlanning(false);
    }
  }

  async function handleCreateRelease(input: {
    facilitatorId: string | null;
    scheduledFor: string | null;
    sprintCount: number;
  }) {
    if (creatingRelease) return;
    setCreatingRelease(true);
    try {
      const res = await fetchOrThrow("/api/planning-sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectId,
          title: "Release Planning",
          sprintCount: input.sprintCount,
          facilitatorId: input.facilitatorId,
          scheduledFor: input.scheduledFor,
        }),
      });
      await res.json();
      setReleaseSheetOpen(false);
      toast.success("Release Planning criado.");
      router.push(`/projects/${projectId}/planning`);
    } catch (err) {
      showErrorToast(err, { label: "Falha ao criar Release Planning" });
    } finally {
      setCreatingRelease(false);
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
          {(canManage || canCreatePMReview) && (
            <Button
              size="sm"
              onClick={() => setPickerOpen(true)}
              disabled={creatingPlanning || creatingPMReview}
            >
              <Plus className="size-3.5" />
              Novo Ritual
            </Button>
          )}
        </div>
      </div>

      <RitualPickerModal
        open={pickerOpen}
        onOpenChange={setPickerOpen}
        onSelect={handlePickRitual}
        canManage={canManage}
        canPMReview={canCreatePMReview}
      />

      {/* Zona 3 — Colunas: Publicado vs Em rascunho */}
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
        <div className="grid grid-cols-1 items-start gap-3 md:grid-cols-2">
          <RitualColumn
            title="Publicado"
            tone="emerald"
            count={published.length}
            items={published}
            onEdit={handleEdit}
            emptyLabel="Nada publicado ainda."
          />
          <RitualColumn
            title="Em rascunho"
            tone="amber"
            count={staging.length}
            items={staging}
            onEdit={handleEdit}
            emptyLabel="Nenhum rascunho em aberto."
          />
        </div>
      )}

      <PlanningSheet
        open={planningSheetOpen}
        onOpenChange={(open) => {
          setPlanningSheetOpen(open);
          if (!open) setEditingPlanning(null);
        }}
        projectId={projectId}
        planning={
          editingPlanning
            ? {
                id: editingPlanning.id,
                sprintId: editingPlanning.sprintId,
                facilitatorId: editingPlanning.facilitatorId,
                scheduledFor: editingPlanning.scheduledFor,
                phase: editingPlanning.status,
              }
            : null
        }
        onCreate={handleCreatePlanning}
        onUpdated={() => {
          setEditingPlanning(null);
          load();
        }}
        onDeleted={() => {
          setEditingPlanning(null);
          load();
        }}
        saving={creatingPlanning}
      />

      <PMReviewSheet
        open={pmReviewSheetOpen}
        onOpenChange={(open) => {
          setPMReviewSheetOpen(open);
          if (!open) setEditingPMReview(null);
        }}
        projectId={projectId}
        pmReview={
          editingPMReview
            ? {
                id: editingPMReview.id,
                facilitatorId: editingPMReview.facilitatorId,
                scheduledFor: editingPMReview.scheduledFor,
                referenceWeek: editingPMReview.referenceWeek,
                status: editingPMReview.status,
              }
            : null
        }
        onCreate={handleCreatePMReview}
        onUpdated={() => {
          setEditingPMReview(null);
          load();
        }}
        onDeleted={() => {
          setEditingPMReview(null);
          load();
        }}
        saving={creatingPMReview}
      />

      <ReleasePlanningSheet
        open={releaseSheetOpen}
        onOpenChange={(open) => {
          setReleaseSheetOpen(open);
          if (!open) setEditingRelease(null);
        }}
        projectId={projectId}
        planning={
          editingRelease
            ? {
                id: editingRelease.id,
                facilitatorId: editingRelease.facilitatorId,
                scheduledFor: editingRelease.scheduledFor,
                sprintCount: editingRelease.sprintCount,
                status: editingRelease.status,
              }
            : null
        }
        onCreate={handleCreateRelease}
        onUpdated={() => {
          setEditingRelease(null);
          load();
        }}
        onDeleted={() => {
          setEditingRelease(null);
          load();
        }}
        saving={creatingRelease}
      />
    </div>
  );
}

// ─── Colunas (Publicado / Em rascunho) ─────────────────────────────────

const COLUMN_TONE = {
  emerald: {
    Icon: CheckCircle2,
    header:
      "text-emerald-700 dark:text-emerald-400",
    dot: "bg-emerald-500",
  },
  amber: {
    Icon: FileEdit,
    header: "text-amber-700 dark:text-amber-500",
    dot: "bg-amber-500",
  },
} as const;

function RitualColumn({
  title,
  tone,
  count,
  items,
  onEdit,
  emptyLabel,
}: {
  title: string;
  tone: keyof typeof COLUMN_TONE;
  count: number;
  items: RitualItem[];
  onEdit: (item: RitualItem) => void;
  emptyLabel: string;
}) {
  const t = COLUMN_TONE[tone];
  const Icon = t.Icon;
  return (
    <div className="overflow-hidden rounded-md border bg-card">
      <div className="flex items-center gap-2 border-b bg-muted/30 px-3 py-2">
        <span
          aria-hidden
          className={cn("size-1.5 rounded-full", t.dot)}
        />
        <Icon className={cn("size-3.5", t.header)} />
        <p className={cn("text-xs font-semibold uppercase tracking-wider", t.header)}>
          {title}
        </p>
        <span className="ml-1 font-mono text-[10px] tabular-nums text-muted-foreground">
          {count}
        </span>
      </div>
      {items.length === 0 ? (
        <p className="px-3 py-6 text-center text-xs text-muted-foreground">
          {emptyLabel}
        </p>
      ) : (
        <ul className="divide-y">
          {items.map((it) => (
            <RitualRow
              key={`${it.kind}:${it.id}`}
              item={it}
              onEdit={onEdit}
            />
          ))}
        </ul>
      )}
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
    label: "Sprint Planning",
    Icon: CalendarClock,
    iconBox:
      "bg-sky-50 text-sky-700 ring-sky-200 dark:bg-sky-950/40 dark:text-sky-300 dark:ring-sky-900/50",
    chip:
      "border-sky-200 bg-sky-50 text-sky-700 dark:border-sky-900/60 dark:bg-sky-950/40 dark:text-sky-300",
  },
  release_planning: {
    label: "Release Planning",
    Icon: Sparkles,
    iconBox:
      "bg-rose-50 text-rose-700 ring-rose-200 dark:bg-rose-950/40 dark:text-rose-300 dark:ring-rose-900/50",
    chip:
      "border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-900/60 dark:bg-rose-950/40 dark:text-rose-300",
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
  if (item.kind === "release_planning") {
    return item.title.trim() || "—";
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

function RitualRow({
  item,
  onEdit,
}: {
  item: RitualItem;
  onEdit: (item: RitualItem) => void;
}) {
  const tone =
    item.kind === "planning"
      ? planningTone(item.status)
      : item.kind === "release_planning"
        ? releaseTone(item.status)
        : pmReviewTone(item.status);
  const label =
    item.kind === "planning"
      ? PLANNING_STATUS_LABEL[item.status]
      : item.kind === "release_planning"
        ? RELEASE_STATUS_LABEL[item.status]
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
      <button
        type="button"
        onClick={() => onEdit(item)}
        aria-label={`Editar ${visual.label}: ${title}`}
        className="min-w-0 flex-1 text-left focus-visible:outline-none"
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
      </button>
      <Link
        href={item.href}
        aria-label="Abrir Command Center"
        onClick={(e) => e.stopPropagation()}
        className="inline-flex size-6 shrink-0 items-center justify-center rounded-md bg-primary text-primary-foreground transition-colors hover:bg-primary/85 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
      >
        <Play className="size-3 fill-current" />
      </Link>
    </li>
  );
}
