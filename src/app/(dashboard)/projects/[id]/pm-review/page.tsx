"use client";

import { use, useCallback, useEffect, useMemo, useState } from "react";
import { Sparkles } from "lucide-react";
import { PageTitle } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { fetchOrThrow, showErrorToast } from "@/lib/optimistic/toast";
import { toast } from "sonner";
import { fmtWeek } from "@/lib/date-utils";
import {
  CronogramaRail,
  type CronogramaBlock,
} from "@/components/timeline/cronograma";
import { PMReviewWorkspace } from "@/components/pm-review/pm-review-workspace";
import { PMReviewWeekSheet } from "@/components/pm-review/pm-review-week-sheet";
import type { PMReviewSummary } from "@/lib/dal/pm-review";
import { brtMonday, weeksBetween, ddmm } from "@/lib/pm-review/week";
import { useProjectMeta } from "../_hooks/use-project-meta";

type Sprint = { id: string; name: string; startDate: string; endDate: string };

/**
 * App única do PM Review por projeto (espelha `/projects/[id]/planning`).
 * Abre na semana corrente; a régua é uma GRADE SEMANAL ancorada nos sprints
 * (D1) — cada célula = uma semana, navegável. Toda review é editável (D4/D5);
 * o status é só rótulo. Célula vazia ≤ hoje → "Fazer PM Review" (back-dated, D13).
 * Régua exclui archived (D11). Runbook: docs/runbooks/pm-review-unified-app.
 */
export default function ProjectPMReviewPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id: projectId } = use(params);
  const { project } = useProjectMeta(projectId);

  const [reviews, setReviews] = useState<PMReviewSummary[]>([]);
  const [sprints, setSprints] = useState<Sprint[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedWeek, setSelectedWeek] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  // Side-sheet do log da semana (clicar num bloco abre; "Abrir" carrega o workspace).
  const [sheetOpen, setSheetOpen] = useState(false);
  const [sheetWeek, setSheetWeek] = useState<string | null>(null);

  const currentMonday = useMemo(() => brtMonday(new Date()), []);
  // Deep-link `?week=YYYY-MM-DD` (vindo dos hrefs de Rituais/overview) → semana
  // inicial. Lido 1× do URL no mount (SSR-safe, sem useSearchParams/Suspense).
  const [initialWeekParam] = useState<string | null>(() =>
    typeof window !== "undefined"
      ? new URLSearchParams(window.location.search).get("week")
      : null,
  );

  // ─── Data loading ────────────────────────────────────────────────────

  const loadReviews = useCallback(async () => {
    const r = await fetch(`/api/projects/${projectId}/pm-reviews`);
    const items = r.ok ? ((await r.json()) as PMReviewSummary[]) : [];
    setReviews(items);
    return items;
  }, [projectId]);

  const loadSprints = useCallback(async () => {
    try {
      const r = await fetch(`/api/sprints?projectId=${projectId}&status=all`);
      setSprints(r.ok ? ((await r.json()) as Sprint[]) : []);
    } catch {
      setSprints([]);
    }
  }, [projectId]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    Promise.all([loadReviews(), loadSprints()])
      .then(([items]) => {
        if (cancelled) return;
        // Default de abertura: semana corrente se já tem review; senão a última
        // published; senão a mais recente; senão a própria semana corrente (vazia).
        const active = items.filter((r) => r.status !== "archived");
        const byWeekDesc = [...active].sort((a, b) =>
          b.referenceWeek.localeCompare(a.referenceWeek),
        );
        const current = active.find((r) => r.referenceWeek === currentMonday);
        const latestPub = byWeekDesc.find((r) => r.status === "published");
        setSelectedWeek(
          initialWeekParam ??
            current?.referenceWeek ??
            latestPub?.referenceWeek ??
            byWeekDesc[0]?.referenceWeek ??
            currentMonday,
        );
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [loadReviews, loadSprints, currentMonday, initialWeekParam]);

  // ─── Régua (grade-semanal ancorada nos sprints) ───────────────────────

  // Archived fica fora da timeline (D11).
  const activeReviews = useMemo(
    () => reviews.filter((r) => r.status !== "archived"),
    [reviews],
  );
  const reviewByWeek = useMemo(
    () => new Map(activeReviews.map((r) => [r.referenceWeek, r])),
    [activeReviews],
  );

  const blocks = useMemo<CronogramaBlock[]>(() => {
    const sprintByWeek = new Map(sprints.map((s) => [s.startDate.slice(0, 10), s]));
    // Régua = cronograma INTEIRO do projeto (mesma experiência do Planning): da
    // semana mais antiga (review/sprint/corrente) até a mais à frente entre a
    // última sprint e a corrente. Semanas depois de hoje entram inertes
    // (kind "future"); D13 mantém autoria só em células ≤ hoje (ver canAuthor).
    const candidates = [
      ...sprints.map((s) => s.startDate.slice(0, 10)),
      ...activeReviews.map((r) => r.referenceWeek),
      currentMonday,
    ];
    const left = candidates.reduce((m, w) => (w < m ? w : m), currentMonday);
    const right = candidates.reduce((m, w) => (w > m ? w : m), currentMonday);
    return weeksBetween(left, right).map<CronogramaBlock>((w) => {
      const review = reviewByWeek.get(w);
      const sprint = sprintByWeek.get(w);
      return {
        key: w,
        dateLabel: ddmm(w),
        label: sprint?.name ?? null,
        kind: w === currentMonday ? "current" : w > currentMonday ? "future" : "past",
        // logCount>0 = "tem review" (célula acesa); 0 = vazia (tracejada).
        logCount: review ? Math.max(review.noteTotal, 1) : 0,
      };
    });
  }, [sprints, activeReviews, reviewByWeek, currentMonday]);

  const selectedReview = selectedWeek ? reviewByWeek.get(selectedWeek) ?? null : null;
  const canAuthor = !!selectedWeek && selectedWeek <= currentMonday;

  // ─── Autoria back-dated (célula vazia ≤ hoje) ─────────────────────────

  const handleCreate = useCallback(
    async (week: string) => {
      if (week > currentMonday) {
        toast.error("Não dá pra fazer review de semana futura.");
        return;
      }
      setCreating(true);
      try {
        await fetchOrThrow(`/api/pm-review`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ projectId, referenceWeek: week }),
        });
        await loadReviews();
        setSelectedWeek(week);
        toast.success("PM Review criada — peça a síntese à Vitoria no chat.");
      } catch (e) {
        showErrorToast(e, { label: "Falha ao criar PM Review" });
      } finally {
        setCreating(false);
      }
    },
    [projectId, currentMonday, loadReviews],
  );

  // ─── Render ────────────────────────────────────────────────────────────

  // Régua grade-semanal (mini). Renderizada ABAIXO da ribbon (via topSlot do
  // workspace) quando há review aberta — mesma ordem do Planning; e no topo do
  // estado vazio pra navegação seguir disponível. Clicar abre o side-sheet.
  const cronogramaStrip = (
    <CronogramaRail
      label="Semanas"
      blocks={blocks}
      selectedKey={sheetOpen ? sheetWeek : selectedWeek}
      onSelect={(w) => {
        setSheetWeek(w);
        setSheetOpen(true);
      }}
      action={
        <Button
          variant="ghost"
          size="sm"
          className="h-7 text-xs"
          onClick={() => setSelectedWeek(currentMonday)}
        >
          Semana atual
        </Button>
      }
    />
  );

  return (
    <div className="-mx-3 -my-4 flex h-[calc(100svh-3rem)] flex-col overflow-hidden sm:-mx-4 md:h-[calc(100svh-3.5rem)] lg:-m-6">
      <PageTitle
        title={project?.name ?? "PM Review"}
        subtitle={
          selectedWeek ? `PM Review · ${fmtWeek(selectedWeek)}` : "PM Review"
        }
      />

      <div className="min-h-0 flex-1">
        {loading ? (
          <div className="p-6 text-sm text-muted-foreground">Carregando…</div>
        ) : selectedReview ? (
          <PMReviewWorkspace
            key={selectedReview.id}
            pmReviewId={selectedReview.id}
            topSlot={cronogramaStrip}
            onChanged={loadReviews}
          />
        ) : (
          <div className="flex h-full min-h-0 flex-col">
            {cronogramaStrip}
            <div className="grid flex-1 place-items-center p-6">
              <div className="max-w-md rounded-lg border border-dashed p-10 text-center">
                <p className="mb-1 font-medium">
                  Nenhuma PM Review
                  {selectedWeek ? ` na semana de ${fmtWeek(selectedWeek)}` : ""}
                </p>
                <p className="mb-4 text-sm text-muted-foreground">
                  {canAuthor
                    ? "Crie a review desta semana — depois peça a síntese à Vitoria, que lê os insumos linkados."
                    : "Selecione uma semana com review na régua acima."}
                </p>
                {canAuthor && selectedWeek && (
                  <Button onClick={() => handleCreate(selectedWeek)} disabled={creating}>
                    <Sparkles className="size-4" />
                    Fazer PM Review desta semana
                  </Button>
                )}
              </div>
            </div>
          </div>
        )}
      </div>

      <PMReviewWeekSheet
        open={sheetOpen}
        onOpenChange={setSheetOpen}
        blocks={blocks}
        week={sheetWeek}
        onSelectWeek={setSheetWeek}
        review={sheetWeek ? reviewByWeek.get(sheetWeek) ?? null : null}
        canAuthor={!!sheetWeek && sheetWeek <= currentMonday}
        creating={creating}
        onOpen={(w) => {
          setSelectedWeek(w);
          setSheetOpen(false);
        }}
        onCreate={(w) => {
          setSheetOpen(false);
          handleCreate(w);
        }}
      />
    </div>
  );
}
