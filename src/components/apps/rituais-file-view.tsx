"use client";

/**
 * Rituais como file system (superfície desktop do app no tab Apps).
 *
 * Cada arquivo = um ritual (Sprint Planning / PM Review / Release Planning) —
 * lista única, sem colunas: publicado/rascunho é só tag na row. Criação e
 * edição reusam integralmente os sheets existentes (PlanningSheet,
 * PMReviewSheet, ReleasePlanningSheet). Superfície única: desktop (janela no
 * canvas) e mobile (dentro do ResponsiveSheet) renderizam esta mesma view.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { CalendarRange, ClipboardList, Pencil, Plus, Zap } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { PlanningSheet } from "@/components/planning/planning-sheet";
import { PMReviewSheet } from "@/components/pm-review/pm-review-sheet";
import { ReleasePlanningSheet } from "@/components/planning-session/release-planning-sheet";
import {
  RitualPickerModal,
  type RitualType,
} from "@/components/ceremonies/ritual-picker-modal";
import { RitualsSettingsSheet } from "@/components/ceremonies/rituals-settings-sheet";
import { fetchOrThrow, showErrorToast, HttpError } from "@/lib/optimistic/toast";
import { fmtDate } from "@/lib/date-utils";
import { cn } from "@/lib/utils";

import { AppFileBadge, AppFileList, AppFileRow } from "./app-file-list";

// ─── Tipos (espelham GET /api/projects/[id]/rituals) ────────────────────────

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
  badges: { linkedCount: number; noteCount: number; reportGenerated: boolean };
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
  permissions: { canCreatePMReview: boolean };
};

// ─── Labels e tones por kind/status ──────────────────────────────────────────

const KIND_META: Record<
  RitualItem["kind"],
  { label: string; icon: typeof Zap; tile: string }
> = {
  planning: {
    label: "Sprint Planning",
    icon: Zap,
    tile: "bg-blue-500/15 text-blue-500",
  },
  pm_review: {
    label: "PM Review",
    icon: ClipboardList,
    tile: "bg-violet-500/15 text-violet-500",
  },
  release_planning: {
    label: "Release Planning",
    icon: CalendarRange,
    tile: "bg-indigo-500/15 text-indigo-500",
  },
};

function statusBadge(item: RitualItem): {
  label: string;
  tone: "green" | "amber" | "muted";
} {
  if (item.kind === "planning") {
    if (item.status === "closed") return { label: "concluída", tone: "green" };
    if (item.status === "archived") return { label: "arquivada", tone: "muted" };
    return { label: "em planejamento", tone: "amber" };
  }
  if (item.kind === "pm_review") {
    if (item.status === "published") return { label: "publicado", tone: "green" };
    if (item.status === "archived") return { label: "arquivado", tone: "muted" };
    return { label: "rascunho", tone: "amber" };
  }
  if (item.status === "approved") return { label: "aprovado", tone: "green" };
  if (item.status === "error" || item.status === "aborted")
    return { label: item.status === "error" ? "erro" : "abortado", tone: "muted" };
  return { label: "rascunho", tone: "amber" };
}

type FilterKey = "all" | "planning" | "pm_review" | "release_planning";

const FILTERS: { key: FilterKey; label: string }[] = [
  { key: "all", label: "Todas" },
  { key: "planning", label: "Sprint Planning" },
  { key: "release_planning", label: "Release Planning" },
  { key: "pm_review", label: "PM Review" },
];

// ─── Componente ──────────────────────────────────────────────────────────────

export function RituaisFileView({
  projectId,
  projectName,
  canManage,
}: {
  projectId: string;
  projectName: string;
  canManage: boolean;
}) {
  const router = useRouter();

  const [items, setItems] = useState<RitualItem[]>([]);
  const [canCreatePMReview, setCanCreatePMReview] = useState(false);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<FilterKey>("all");

  const [pickerOpen, setPickerOpen] = useState(false);
  const [planningSheetOpen, setPlanningSheetOpen] = useState(false);
  const [pmReviewSheetOpen, setPMReviewSheetOpen] = useState(false);
  const [releaseSheetOpen, setReleaseSheetOpen] = useState(false);
  const [creatingPlanning, setCreatingPlanning] = useState(false);
  const [creatingPMReview, setCreatingPMReview] = useState(false);
  const [creatingRelease, setCreatingRelease] = useState(false);
  const [editingPlanning, setEditingPlanning] = useState<RitualPlanning | null>(null);
  const [editingPMReview, setEditingPMReview] = useState<RitualPMReview | null>(null);
  const [editingRelease, setEditingRelease] = useState<RitualReleasePlanning | null>(null);

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
    void load();
  }, [load]);

  const visible = useMemo(
    () => (filter === "all" ? items : items.filter((i) => i.kind === filter)),
    [items, filter],
  );

  const handleEdit = useCallback((item: RitualItem) => {
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
  }, []);

  const handlePickRitual = useCallback((type: RitualType) => {
    if (type === "pm_review") setPMReviewSheetOpen(true);
    else if (type === "sprint_planning") setPlanningSheetOpen(true);
    else if (type === "release_planning") {
      setEditingRelease(null);
      setReleaseSheetOpen(true);
    } else {
      // Kickoff Interno/Externo: fluxo ainda em definição — só no picker.
      toast.info("Em breve — o fluxo deste ritual ainda está em definição.");
    }
  }, []);

  // ─── Create handlers (mesmo wiring da ProjectCeremoniesTab) ───────────────

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
      // "1 planning viva por sprint": já existe ativa → abre a existente.
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
          // body não-JSON → erro genérico abaixo
        }
      }
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
      // Singleton: backend faz resolve-or-create. `existed` = já havia uma ativa,
      // então abrimos a existente em vez de criar uma 2ª.
      const { existed } = (await res.json()) as { existed?: boolean };
      setReleaseSheetOpen(false);
      if (existed) {
        toast.info("Já existe um Release Planning ativo — abrindo o existente.");
      } else {
        toast.success("Release Planning criado.");
      }
      router.push(`/projects/${projectId}/planning`);
    } catch (err) {
      showErrorToast(err, { label: "Falha ao criar Release Planning" });
    } finally {
      setCreatingRelease(false);
    }
  }

  // ─── Render ────────────────────────────────────────────────────────────────

  // Navegação: clique na row ENTRA no ritual — Command Center é a ação
  // primária. A sheet de metadados abre só pelo ícone de editar.
  function renderRow(item: RitualItem) {
    const meta = KIND_META[item.kind];
    const status = statusBadge(item);
    const facilitator = item.facilitatorName ?? "Sem facilitador definido";
    const subtitle =
      item.kind === "planning" && item.sprintName
        ? `${meta.label} · ${item.sprintName} · ${facilitator}`
        : `${meta.label} · ${facilitator}`;
    return (
      <AppFileRow
        key={`${item.kind}-${item.id}`}
        icon={meta.icon}
        tileClassName={meta.tile}
        title={item.title}
        subtitle={subtitle}
        badge={
          <span className="flex shrink-0 items-center gap-1">
            <AppFileBadge tone={status.tone}>{status.label}</AppFileBadge>
          </span>
        }
        meta={item.scheduledFor ? fmtDate(item.scheduledFor) : undefined}
        onOpen={() => router.push(item.href)}
        actions={
          <button
            type="button"
            aria-label={`Editar ${meta.label}: ${item.title}`}
            title="Editar"
            onClick={(e) => {
              e.stopPropagation();
              handleEdit(item);
            }}
            className="inline-flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
          >
            <Pencil className="size-3.5" />
          </button>
        }
      />
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-1.5">
          {FILTERS.map((f) => (
            <button
              key={f.key}
              type="button"
              onClick={() => setFilter(f.key)}
              className={cn(
                "rounded-full border px-2.5 py-1 text-xs transition-colors",
                filter === f.key
                  ? "border-foreground/20 bg-foreground/10 font-medium"
                  : "border-border text-muted-foreground hover:bg-muted/60",
              )}
            >
              {f.label}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <RitualsSettingsSheet
            projectId={projectId}
            canConfigure={canManage || canCreatePMReview}
          />
          {(canManage || canCreatePMReview) && (
            <Button size="sm" onClick={() => setPickerOpen(true)}>
              <Plus className="size-3.5" /> Novo ritual
            </Button>
          )}
        </div>
      </div>

      {loading ? (
        <p className="px-1 py-8 text-center text-sm text-muted-foreground">Carregando…</p>
      ) : visible.length === 0 ? (
        <p className="px-1 py-8 text-center text-sm text-muted-foreground">
          Nenhum ritual em {projectName} — crie o primeiro arquivo deste app.
        </p>
      ) : (
        <AppFileList>{visible.map(renderRow)}</AppFileList>
      )}

      {/* Fluxos existentes de criação/edição — reuso integral */}
      <RitualPickerModal
        open={pickerOpen}
        onOpenChange={setPickerOpen}
        onSelect={handlePickRitual}
        canManage={canManage}
        canPMReview={canCreatePMReview}
      />

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
