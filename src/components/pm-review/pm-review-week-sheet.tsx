"use client";

import { useEffect, useState } from "react";
import { Sparkles } from "lucide-react";
import {
  ResponsiveSheet,
  ResponsiveSheetBody,
  ResponsiveSheetContent,
  ResponsiveSheetDescription,
  ResponsiveSheetHeader,
  ResponsiveSheetTitle,
} from "@/components/ui/responsive-sheet";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Cronograma, type CronogramaBlock } from "@/components/timeline/cronograma";
import { fmtWeek, fmtDate } from "@/lib/date-utils";
import type { PMReviewDetail, PMReviewSummary } from "@/lib/dal/pm-review";

/** Rótulos PT dos kinds de note (fallback no próprio kind se desconhecido). */
const KIND_LABEL: Record<string, string> = {
  summary: "resumo",
  project_direction: "direção",
  next_step: "próximo passo",
  risk: "risco",
  need: "necessidade",
  team_signal: "sinal do time",
  open_decision: "decisão",
  milestone: "milestone",
};

type LogEntry = { at: string; label: string; detail?: string | null };

/**
 * Side-sheet "PM Review por semana" — navegador de semanas, espelha o
 * `PlanningHistorySheet`: o cronograma EXPANDIDO (variant `full`) funciona como
 * week-picker e, abaixo, o **log da semana selecionada** (derivado — D17 — de
 * cada note + report sintetizado + publicação). Selecionar uma semana troca o
 * foco; "Abrir esta review" carrega no workspace. Célula vazia ≤ hoje →
 * "Fazer PM Review" (back-dated).
 */
export function PMReviewWeekSheet({
  open,
  onOpenChange,
  blocks,
  week,
  onSelectWeek,
  review,
  canAuthor,
  creating,
  onOpen,
  onCreate,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  /** Régua completa (week-picker). */
  blocks: CronogramaBlock[];
  /** Semana em foco (YYYY-MM-DD) ou null. */
  week: string | null;
  /** Clicar numa célula do cronograma troca o foco. */
  onSelectWeek: (key: string) => void;
  /** Resumo da review da semana em foco (null = vazia). */
  review: PMReviewSummary | null;
  canAuthor: boolean;
  creating: boolean;
  onOpen: (week: string) => void;
  onCreate: (week: string) => void;
}) {
  // Log keyed por reviewId — não mostra stale ao trocar de semana e evita reset
  // de state síncrono no effect (só seta via callback async).
  const [log, setLog] = useState<{ id: string; entries: LogEntry[] } | null>(null);

  const reviewId = review?.id ?? null;

  useEffect(() => {
    if (!open || !reviewId) return;
    let cancelled = false;
    fetch(`/api/pm-review/${reviewId}`)
      .then((r) => (r.ok ? (r.json() as Promise<PMReviewDetail>) : null))
      .then((d) => {
        if (cancelled) return;
        const entries: LogEntry[] = [];
        if (d?.publishedAt) entries.push({ at: d.publishedAt, label: "Publicada" });
        if (d?.reportGeneratedAt)
          entries.push({ at: d.reportGeneratedAt, label: "Report sintetizado" });
        for (const n of d?.notes ?? []) {
          const who = n.generatedByAgent ? "Vitoria" : "PM";
          entries.push({
            at: n.generatedAt,
            label: `${KIND_LABEL[n.kind] ?? n.kind} · ${who}`,
            detail: n.content,
          });
        }
        entries.sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));
        setLog({ id: reviewId, entries });
      })
      .catch(() => {
        if (!cancelled) setLog({ id: reviewId, entries: [] });
      });
    return () => {
      cancelled = true;
    };
  }, [open, reviewId]);

  const ready = !!reviewId && log?.id === reviewId;
  const entries = ready ? (log?.entries ?? []) : null;
  const loadingLog = !!reviewId && open && !ready;

  const statusLabel =
    review?.status === "published"
      ? "publicada"
      : review?.status === "archived"
        ? "arquivada"
        : review
          ? "rascunho"
          : null;

  return (
    <ResponsiveSheet open={open} onOpenChange={onOpenChange}>
      <ResponsiveSheetContent size="md">
        <ResponsiveSheetHeader>
          <ResponsiveSheetTitle>PM Review por semana</ResponsiveSheetTitle>
          <ResponsiveSheetDescription>
            Navegue as semanas no cronograma. Abrir carrega a review no workspace.
          </ResponsiveSheetDescription>
        </ResponsiveSheetHeader>

        <ResponsiveSheetBody className="space-y-5">
          {/* Cronograma expandido = week-picker dentro do sheet. */}
          <div className="space-y-2">
            <div className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
              Cronograma
            </div>
            <Cronograma
              shape="chip"
              layout="wrap"
              blocks={blocks}
              selectedKey={week}
              onSelect={onSelectWeek}
            />
          </div>

          {/* Log da semana selecionada. */}
          <div className="space-y-2">
            <div className="flex items-center gap-2 text-sm font-medium">
              {week ? fmtWeek(week) : "Semana"}
              {statusLabel && (
                <Badge variant={review?.status === "published" ? "default" : "secondary"}>
                  {statusLabel}
                </Badge>
              )}
            </div>

            {review ? (
              <>
                {loadingLog ? (
                  <p className="py-2 text-sm text-muted-foreground">Carregando…</p>
                ) : entries && entries.length > 0 ? (
                  <ol className="space-y-2.5">
                    {entries.map((e, i) => (
                      <li key={i} className="flex gap-3 text-sm">
                        <span className="mt-1 size-1.5 shrink-0 rounded-full bg-primary/60" />
                        <div className="min-w-0">
                          <div className="flex items-baseline gap-2">
                            <span className="font-medium">{e.label}</span>
                            <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground">
                              {fmtDate(e.at)}
                            </span>
                          </div>
                          {e.detail && (
                            <p className="truncate text-xs text-muted-foreground">
                              {e.detail}
                            </p>
                          )}
                        </div>
                      </li>
                    ))}
                  </ol>
                ) : (
                  <p className="py-2 text-sm text-muted-foreground">
                    Sem atividade registrada nesta semana ainda.
                  </p>
                )}

                <Button
                  className="w-full"
                  onClick={() => week && onOpen(week)}
                  disabled={!week}
                >
                  Abrir esta review →
                </Button>
              </>
            ) : (
              <div className="space-y-3 py-2">
                <p className="text-sm text-muted-foreground">
                  {canAuthor
                    ? "Nenhuma review nesta semana. Crie — depois peça a síntese à Vitoria."
                    : "Nenhuma review nesta semana."}
                </p>
                {canAuthor && week && (
                  <Button
                    className="w-full"
                    onClick={() => onCreate(week)}
                    disabled={creating}
                  >
                    <Sparkles className="size-4" />
                    Fazer PM Review desta semana
                  </Button>
                )}
              </div>
            )}
          </div>
        </ResponsiveSheetBody>
      </ResponsiveSheetContent>
    </ResponsiveSheet>
  );
}
