"use client";

import { useCallback, useEffect, useState } from "react";
import { Inbox, Layers, Sparkles, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { RefinementChip, ComputedStatusChip } from "@/components/story-hierarchy/chips";
import {
  describeEntityProposal,
  type PlanningAction,
} from "@/components/planning/proposal-card";
import type {
  ComputedStatus,
  RefinementStatus,
} from "@/components/story-hierarchy/types";
import type { StoryWithRelations } from "@/lib/dal/story-hierarchy";

const INBOX_KEY = "__inbox__";

/**
 * Vista "User Stories" do canvas do Release Planning — lente alternativa ao
 * board de tasks. Mostra:
 *  • PROPOSTAS pendentes de story/módulo da Vitoria (cards aprováveis, igual às
 *    tasks): editar/commitar US, aprovar módulo. Aplicam no Concluir; X rejeita.
 *  • As user stories VIVAS, agrupadas por módulo (+ INBOX pras sem módulo).
 *
 * Story criada NOVA já aparece viva (propose_story é live/draft) — o que vira
 * card é a MUDANÇA (commit, módulo, AC) que o PM aprova.
 */
export function ReleasePlanningStories({
  projectId,
  planningCeremonyId,
  refreshKey,
  readOnly,
  onCountChange,
  onOpenStory,
}: {
  projectId: string;
  planningCeremonyId: string | null;
  refreshKey: number;
  readOnly?: boolean;
  onCountChange?: (n: number) => void;
  /** Click numa story → abre o side sheet de detalhe (página controla). */
  onOpenStory?: (ref: string) => void;
}) {
  const [stories, setStories] = useState<StoryWithRelations[]>([]);
  const [proposals, setProposals] = useState<PlanningAction[]>([]);
  const [loading, setLoading] = useState(true);
  const [bumping, setBumping] = useState(0);

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      fetch(`/api/projects/${projectId}/stories`)
        .then((r) => (r.ok ? r.json() : { stories: [] }))
        .catch(() => ({ stories: [] })),
      planningCeremonyId
        ? fetch(`/api/planning/${planningCeremonyId}/actions`)
            .then((r) => (r.ok ? r.json() : []))
            .catch(() => [])
        : Promise.resolve([]),
    ])
      .then(([s, actions]: [{ stories: StoryWithRelations[] }, PlanningAction[]]) => {
        if (cancelled) return;
        setStories(s.stories ?? []);
        onCountChange?.(s.stories?.length ?? 0);
        setProposals(
          (actions ?? []).filter(
            (a) =>
              (a.entityType === "story" || a.entityType === "module") &&
              a.decision === "pending" &&
              a.execution === "pending",
          ),
        );
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [projectId, planningCeremonyId, refreshKey, bumping, onCountChange]);

  const reject = useCallback(
    async (actionId: string) => {
      // Otimista: some do card na hora; rejeição persiste e o Concluir pula.
      setProposals((prev) => prev.filter((p) => p.id !== actionId));
      try {
        await fetch(`/api/planning/${planningCeremonyId}/actions/${actionId}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ decision: "rejected" }),
        });
      } finally {
        setBumping((n) => n + 1);
      }
    },
    [planningCeremonyId],
  );

  if (loading && stories.length === 0 && proposals.length === 0) {
    return <div className="p-6 text-sm text-muted-foreground">Carregando stories…</div>;
  }

  // Agrupa stories vivas por módulo (+ INBOX pras sem módulo). Ordem de chegada.
  const groups: Array<{ key: string; name: string; rows: StoryWithRelations[] }> = [];
  const index = new Map<string, number>();
  for (const s of stories) {
    const key = s.module?.id ?? INBOX_KEY;
    let i = index.get(key);
    if (i === undefined) {
      i = groups.length;
      index.set(key, i);
      groups.push({ key, name: s.module?.name ?? "Sem módulo", rows: [] });
    }
    groups[i].rows.push(s);
  }

  const empty = stories.length === 0 && proposals.length === 0;

  return (
    <div>
      {proposals.length > 0 && (
        <section className="border-b">
          <div className="flex items-center gap-2 border-b bg-brand/5 px-3 py-2">
            <Sparkles className="size-3.5 text-brand" />
            <span className="text-xs font-semibold uppercase tracking-wide text-foreground">
              Propostas pendentes
            </span>
            <span className="ml-auto font-mono text-xs text-muted-foreground">
              {proposals.length}
            </span>
          </div>
          {proposals.map((a) => (
            <div
              key={a.id}
              className="flex items-start gap-3 border-b border-dashed px-3 py-2.5 last:border-b-0"
            >
              <Badge
                variant="secondary"
                className="mt-0.5 shrink-0 capitalize"
              >
                {a.entityType}
              </Badge>
              <div className="min-w-0 flex-1 space-y-1">
                <div className="text-sm font-medium">{describeEntityProposal(a)}</div>
                {a.aiReasoning && (
                  <p className="line-clamp-2 text-xs text-muted-foreground">
                    {a.aiReasoning}
                  </p>
                )}
              </div>
              {!readOnly && (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="size-7 shrink-0 text-muted-foreground hover:text-red-600"
                  title="Rejeitar proposta"
                  onClick={() => reject(a.id)}
                >
                  <X className="size-4" />
                </Button>
              )}
            </div>
          ))}
        </section>
      )}

      {empty && (
        <div className="p-8 text-center text-sm text-muted-foreground">
          Nenhuma user story ainda. Peça pra Vitoria produzir as stories no chat.
        </div>
      )}

      {groups.map((g) => {
        const isInbox = g.key === INBOX_KEY;
        return (
          <section key={g.key} className="border-t first:border-t-0">
            <div className="flex items-center gap-2 border-b bg-muted px-3 py-2">
              {isInbox ? (
                <Inbox className="size-3.5 text-amber-600 dark:text-amber-400" />
              ) : (
                <Layers className="size-3.5 text-muted-foreground" />
              )}
              <span className="text-xs font-semibold uppercase tracking-wide text-foreground">
                {g.name}
              </span>
              <span className="ml-auto font-mono text-xs text-muted-foreground">
                {g.rows.length} {g.rows.length === 1 ? "story" : "stories"}
              </span>
            </div>

            {g.rows.map((s) => {
              const ov = s.overview;
              return (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => onOpenStory?.(s.reference)}
                  className="flex w-full items-start gap-3 px-3 py-2.5 text-left transition-colors hover:bg-muted/50"
                >
                  <span className="mt-0.5 shrink-0 font-mono text-xs tabular-nums text-muted-foreground">
                    {s.reference}
                  </span>
                  <div className="min-w-0 flex-1 space-y-1">
                    <div className="text-sm">{s.title}</div>
                    <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                      <RefinementChip status={s.refinementStatus as RefinementStatus} />
                      {ov?.computedStatus && (
                        <ComputedStatusChip status={ov.computedStatus as ComputedStatus} />
                      )}
                      {ov && ov.totalTasks ? (
                        <span className="font-mono tabular-nums">
                          {ov.doneTasks ?? 0}/{ov.totalTasks} tasks
                        </span>
                      ) : null}
                      {ov && ov.totalFunctionPoints ? (
                        <Badge variant="secondary">{ov.totalFunctionPoints} PFV</Badge>
                      ) : null}
                      {s.acceptanceCriteria.length > 0 && (
                        <span>{s.acceptanceCriteria.length} AC</span>
                      )}
                    </div>
                  </div>
                </button>
              );
            })}
          </section>
        );
      })}
    </div>
  );
}
