"use client";

import { useEffect, useState } from "react";
import { Inbox, Layers } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { RefinementChip, ComputedStatusChip } from "@/components/story-hierarchy/chips";
import type {
  ComputedStatus,
  RefinementStatus,
} from "@/components/story-hierarchy/types";
import type { StoryWithRelations } from "@/lib/dal/story-hierarchy";

const INBOX_KEY = "__inbox__";

/**
 * Vista "User Stories" do canvas do Release Planning — lente alternativa ao
 * board de tasks. US NÃO são mapeadas por sprint (uma story atravessa sprints);
 * agrupa por **módulo** (+ INBOX pras sem módulo), espelhando o story-hierarchy.
 *
 * Browse-only: explora o que a Vitoria produziu (ref, título, refinement, status
 * computado, tasks/PFV via `user_story_overview`). Edição rica fica na aba
 * Stories do projeto — esta é a lente rápida ao lado do chat.
 */
export function ReleasePlanningStories({
  projectId,
  refreshKey,
  onCountChange,
}: {
  projectId: string;
  refreshKey: number;
  onCountChange?: (n: number) => void;
}) {
  const [stories, setStories] = useState<StoryWithRelations[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/projects/${projectId}/stories`)
      .then((r) => (r.ok ? r.json() : { stories: [] }))
      .then((d: { stories: StoryWithRelations[] }) => {
        if (cancelled) return;
        setStories(d.stories ?? []);
        onCountChange?.(d.stories?.length ?? 0);
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [projectId, refreshKey, onCountChange]);

  if (loading && stories.length === 0) {
    return <div className="p-6 text-sm text-muted-foreground">Carregando stories…</div>;
  }
  if (stories.length === 0) {
    return (
      <div className="p-8 text-center text-sm text-muted-foreground">
        Nenhuma user story ainda. Peça pra Vitoria produzir as stories no chat.
      </div>
    );
  }

  // Agrupa por módulo (+ INBOX pras sem módulo). Mantém a ordem de chegada.
  const groups: Array<{ key: string; name: string; rows: StoryWithRelations[] }> = [];
  const index = new Map<string, number>();
  for (const s of stories) {
    const key = s.module?.id ?? INBOX_KEY;
    let i = index.get(key);
    if (i === undefined) {
      i = groups.length;
      index.set(key, i);
      groups.push({
        key,
        name: s.module?.name ?? "Sem módulo",
        rows: [],
      });
    }
    groups[i].rows.push(s);
  }

  return (
    <div>
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
                <div key={s.id} className="flex items-start gap-3 px-3 py-2.5">
                  <span className="mt-0.5 shrink-0 font-mono text-xs tabular-nums text-muted-foreground">
                    {s.reference}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="text-sm">{s.title}</div>
                    <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
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
                </div>
              );
            })}
          </section>
        );
      })}
    </div>
  );
}
