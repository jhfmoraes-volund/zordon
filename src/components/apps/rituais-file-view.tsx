"use client";

/**
 * Rituais como file system (superfície desktop do app no tab Apps).
 *
 * Cada arquivo = um ritual (Planning / PM Review) — lista única, sem colunas:
 * publicado/rascunho é só tag na row. Criação e edição reusam integralmente os
 * sheets existentes (PMReviewSheet, ReleasePlanningSheet). Superfície única:
 * desktop (janela no canvas) e mobile (dentro do ResponsiveSheet) renderizam
 * esta mesma view.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { CalendarRange, ClipboardList, Pencil, Plus } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { PMReviewSheet } from "@/components/pm-review/pm-review-sheet";
import { ReleasePlanningSheet } from "@/components/planning-session/release-planning-sheet";
import {
  RitualPickerModal,
  type RitualType,
} from "@/components/ceremonies/ritual-picker-modal";
import { RitualsSettingsSheet } from "@/components/ceremonies/rituals-settings-sheet";
import { fetchOrThrow, showErrorToast } from "@/lib/optimistic/toast";
import { fmtDate } from "@/lib/date-utils";
import { cn } from "@/lib/utils";

import { AppFileBadge, AppFileList, AppFileRow } from "./app-file-list";

// ─── Tipos (espelham GET /api/projects/[id]/rituals) ────────────────────────

type PMReviewStatus = "draft" | "published" | "archived";

type ReleaseStatus =
  | "draft"
  | "orchestrating"
  | "in-review"
  | "approved"
  | "aborted"
  | "error";

type RitualPMReview = {
  kind: "pm_review";
  id: string;
  title: string;
  status: PMReviewStatus;
  scheduledFor: string | null;
  referenceWeek: string;
  /** Contínuo (como Planning): última atividade entre as reviews. */
  lastActivityAt: string;
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
  /** Quando o plano foi usado/atualizado pela última vez (ver GET /rituals). */
  lastActivityAt: string;
  sortKey: string;
  href: string;
  badges: { linkedCount: number; noteCount: number };
  facilitatorId: string | null;
  facilitatorName: string | null;
};

type RitualItem = RitualPMReview | RitualReleasePlanning;

type RitualsResponse = {
  items: RitualItem[];
  permissions: { canCreatePMReview: boolean };
};

// ─── Labels e tones por kind/status ──────────────────────────────────────────

const KIND_META: Record<
  RitualItem["kind"],
  { label: string; icon: typeof ClipboardList; tile: string }
> = {
  pm_review: {
    label: "PM Review",
    icon: ClipboardList,
    tile: "bg-violet-500/15 text-violet-500",
  },
  release_planning: {
    label: "Planning",
    icon: CalendarRange,
    tile: "bg-indigo-500/15 text-indigo-500",
  },
};

/**
 * Planning é singleton contínuo — nunca "publica", então não tem ciclo de vida
 * pra exibir. A linha mostra "ativo" + última atividade (ver renderRow). Só os
 * estados terminais raros (abortado/erro) ganham chip próprio; os demais
 * retornam null = renderiza o chip "ativo".
 */
function releaseTerminalBadge(status: ReleaseStatus): {
  label: string;
  tone: "muted";
} | null {
  if (status === "aborted") return { label: "abortado", tone: "muted" };
  if (status === "error") return { label: "erro", tone: "muted" };
  return null;
}

type FilterKey = "all" | "pm_review" | "release_planning";

const FILTERS: { key: FilterKey; label: string }[] = [
  { key: "all", label: "Todas" },
  { key: "release_planning", label: "Planning" },
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
  const [pmReviewSheetOpen, setPMReviewSheetOpen] = useState(false);
  const [releaseSheetOpen, setReleaseSheetOpen] = useState(false);
  const [creatingPMReview, setCreatingPMReview] = useState(false);
  const [creatingRelease, setCreatingRelease] = useState(false);
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
    if (item.kind === "pm_review") {
      setEditingPMReview(item);
      setPMReviewSheetOpen(true);
    } else {
      setEditingRelease(item);
      setReleaseSheetOpen(true);
    }
  }, []);

  const handlePickRitual = useCallback((type: RitualType) => {
    if (type === "pm_review") setPMReviewSheetOpen(true);
    else if (type === "release_planning") {
      setEditingRelease(null);
      setReleaseSheetOpen(true);
    } else {
      // Kickoff Interno/Externo: fluxo ainda em definição — só no picker.
      toast.info("Em breve — o fluxo deste ritual ainda está em definição.");
    }
  }, []);

  // ─── Create handlers (mesmo wiring da ProjectCeremoniesTab) ───────────────

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
      await res.json();
      setPMReviewSheetOpen(false);
      toast.success("PM Review criado.");
      router.push(`/projects/${projectId}/pm-review?week=${referenceWeek}`);
    } catch (err) {
      showErrorToast(err, { label: "Falha ao criar PM Review" });
    } finally {
      setCreatingPMReview(false);
    }
  }

  async function handleCreateRelease(input: { facilitatorId: string | null }) {
    if (creatingRelease) return;
    setCreatingRelease(true);
    try {
      const res = await fetchOrThrow("/api/planning-sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectId,
          title: "Planning",
          facilitatorId: input.facilitatorId,
        }),
      });
      // Singleton: backend faz resolve-or-create. `existed` = já havia uma ativa,
      // então abrimos a existente em vez de criar uma 2ª.
      const { existed } = (await res.json()) as { existed?: boolean };
      setReleaseSheetOpen(false);
      if (existed) {
        toast.info("Já existe um Planning ativo — abrindo o existente.");
      } else {
        toast.success("Planning criado.");
      }
      router.push(`/projects/${projectId}/planning`);
    } catch (err) {
      showErrorToast(err, { label: "Falha ao criar Planning" });
    } finally {
      setCreatingRelease(false);
    }
  }

  // ─── Render ────────────────────────────────────────────────────────────────

  // Navegação: clique na row ENTRA no ritual — Command Center é a ação
  // primária. A sheet de metadados abre só pelo ícone de editar.
  function renderRow(item: RitualItem) {
    const meta = KIND_META[item.kind];
    const facilitator = item.facilitatorName ?? "Sem facilitador definido";
    const subtitle = `${meta.label} · ${facilitator}`;

    // Planning (contínuo): chip "ativo" + "atualizado <data>" no lugar do status
    // de ciclo de vida + data crua. Estados terminais (abortado/erro) mantêm chip.
    // PM Review: badge de ciclo de vida + data agendada (como antes).
    let badge: React.ReactNode;
    let metaText: string | undefined;
    if (item.kind === "release_planning") {
      const terminal = releaseTerminalBadge(item.status);
      badge = (
        <span className="flex shrink-0 flex-col items-end gap-0.5">
          {terminal ? (
            <AppFileBadge tone={terminal.tone}>{terminal.label}</AppFileBadge>
          ) : (
            <AppFileBadge tone="green">
              <span className="size-1.5 rounded-full bg-current" />
              ativo
            </AppFileBadge>
          )}
          <span className="text-[11px] text-muted-foreground">
            atualizado {fmtDate(item.lastActivityAt)}
          </span>
        </span>
      );
      metaText = undefined;
    } else {
      // PM Review é contínuo por projeto (como Planning): "ativo" + última
      // atividade. As semanas (inclusive antigas) viram navegação na régua da app.
      badge = (
        <span className="flex shrink-0 flex-col items-end gap-0.5">
          <AppFileBadge tone="green">
            <span className="size-1.5 rounded-full bg-current" />
            ativo
          </AppFileBadge>
          <span className="text-[11px] text-muted-foreground">
            atualizado {fmtDate(item.lastActivityAt)}
          </span>
        </span>
      );
      metaText = undefined;
    }

    return (
      <AppFileRow
        key={`${item.kind}-${item.id}`}
        icon={meta.icon}
        tileClassName={meta.tile}
        title={item.title}
        subtitle={subtitle}
        badge={badge}
        meta={metaText}
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
