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
 * Side-sheet ao clicar num bloco da régua: log da semana + entrada na review.
 * Espelha o `PlanningHistorySheet` (navegador no overlay), adaptado ao PM Review:
 * o "log de updates" é DERIVADO (D17 — não há histórico de versões) do que já
 * existe — cada note (por quem + quando) + report sintetizado + publicada, em
 * ordem cronológica desc. Célula vazia ≤ hoje → "Fazer PM Review" (back-dated).
 */
export function PMReviewWeekSheet({
  open,
  onOpenChange,
  week,
  review,
  canAuthor,
  creating,
  onOpen,
  onCreate,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  week: string | null;
  /** Resumo da review da semana (null = semana vazia). */
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
      <ResponsiveSheetContent size="sm">
        <ResponsiveSheetHeader>
          <ResponsiveSheetTitle className="flex items-center gap-2">
            {week ? fmtWeek(week) : "Semana"}
            {statusLabel && (
              <Badge variant={review?.status === "published" ? "default" : "secondary"}>
                {statusLabel}
              </Badge>
            )}
          </ResponsiveSheetTitle>
          <ResponsiveSheetDescription>
            {review
              ? "O que aconteceu nesta semana — notas, síntese e publicação."
              : "Nenhuma PM Review nesta semana ainda."}
          </ResponsiveSheetDescription>
        </ResponsiveSheetHeader>

        <ResponsiveSheetBody className="space-y-4">
          {review ? (
            <>
              {loadingLog ? (
                <p className="py-2 text-sm text-muted-foreground">Carregando log…</p>
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
            <div className="space-y-3 py-2 text-center">
              <p className="text-sm text-muted-foreground">
                {canAuthor
                  ? "Crie a review desta semana — depois peça a síntese à Vitoria."
                  : "Selecione uma semana com review na régua."}
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
        </ResponsiveSheetBody>
      </ResponsiveSheetContent>
    </ResponsiveSheet>
  );
}
