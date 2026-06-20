"use client";

import { use, useCallback, useEffect, useMemo, useState } from "react";
import { Sparkles } from "lucide-react";
import { PageTitle } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { fetchOrThrow, showErrorToast } from "@/lib/optimistic/toast";
import { toast } from "sonner";
import { fmtWeek } from "@/lib/date-utils";
import {
  PlanningCronograma,
  type CronogramaBlock,
} from "@/components/planning-session/planning-cronograma";
import { PMReviewWorkspace } from "@/components/pm-review/pm-review-workspace";
import { PMReviewWeekSheet } from "@/components/pm-review/pm-review-week-sheet";
import type { PMReviewSummary } from "@/lib/dal/pm-review";
import { brtMonday, weeksBetween, ddmm } from "@/lib/pm-review/week";

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
    // Limite esquerdo: a mais antiga entre (semanas com review, segundas de
    // sprint, semana corrente). Direito: a semana corrente (futuro é inerte, D13).
    const candidates = [
      ...sprints.map((s) => s.startDate.slice(0, 10)),
      ...activeReviews.map((r) => r.referenceWeek),
      currentMonday,
    ];
    const left = candidates.reduce((m, w) => (w < m ? w : m), currentMonday);
    return weeksBetween(left, currentMonday).map<CronogramaBlock>((w) => {
      const review = reviewByWeek.get(w);
      const sprint = sprintByWeek.get(w);
      return {
        key: w,
        dateLabel: ddmm(w),
        label: sprint?.name ?? null,
        kind: w === currentMonday ? "current" : "past",
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

  return (
    <div className="-mx-3 -my-4 flex h-[calc(100svh-3rem)] flex-col overflow-hidden sm:-mx-4 md:h-[calc(100svh-3.5rem)] lg:-m-6">
      <PageTitle
        title="PM Review"
        subtitle={selectedWeek ? fmtWeek(selectedWeek) : undefined}
      />

      {/* Régua sempre visível — grade-semanal, navegação por célula. */}
      {blocks.length > 0 && (
        <div className="flex shrink-0 items-center gap-3 border-b bg-background px-6 py-2">
          <span className="shrink-0 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
            Semanas
          </span>
          <PlanningCronograma
            variant="mini"
            blocks={blocks}
            selectedKey={sheetOpen ? sheetWeek : selectedWeek}
            onSelect={(w) => {
              setSheetWeek(w);
              setSheetOpen(true);
            }}
          />
          <Button
            variant="ghost"
            size="sm"
            className="ml-auto h-7 text-xs"
            onClick={() => setSelectedWeek(currentMonday)}
          >
            Semana atual
          </Button>
        </div>
      )}

      <div className="min-h-0 flex-1">
        {loading ? (
          <div className="p-6 text-sm text-muted-foreground">Carregando…</div>
        ) : selectedReview ? (
          <PMReviewWorkspace
            key={selectedReview.id}
            pmReviewId={selectedReview.id}
            onChanged={loadReviews}
          />
        ) : (
          <div className="grid h-full place-items-center p-6">
            <div className="max-w-md rounded-lg border border-dashed p-10 text-center">
              <p className="mb-1 font-medium">
                Nenhuma PM Review{selectedWeek ? ` na semana de ${fmtWeek(selectedWeek)}` : ""}
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
        )}
      </div>

      <PMReviewWeekSheet
        open={sheetOpen}
        onOpenChange={setSheetOpen}
        week={sheetWeek}
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
