"use client";

import { useEffect, useState } from "react";
import { CheckCircle2, Circle } from "lucide-react";
import {
  ResponsiveSheet,
  ResponsiveSheetContent,
  ResponsiveSheetHeader,
  ResponsiveSheetTitle,
  ResponsiveSheetDescription,
  ResponsiveSheetBody,
} from "@/components/ui/responsive-sheet";
import { Badge } from "@/components/ui/badge";
import { StatusChip } from "@/components/ui/status-chip";
import { TASK_STATUS } from "@/lib/status-chips";
import { RefinementChip, ComputedStatusChip } from "@/components/story-hierarchy/chips";
import type {
  ComputedStatus,
  RefinementStatus,
} from "@/components/story-hierarchy/types";
import { TaskSheetByRef } from "@/components/task-sheet-by-ref";
import type { StoryWithRelations } from "@/lib/dal/story-hierarchy";

type StoryTask = {
  id: string;
  reference: string | null;
  title: string;
  status: string;
  functionPoints: number | null;
};

function statusChip(status: string) {
  return (
    TASK_STATUS[status as keyof typeof TASK_STATUS] ?? {
      label: status,
      tone: "muted" as const,
    }
  );
}

/**
 * Side sheet de detalhe de uma User Story — a "experiência completa" da vista de
 * stories do canvas do Planning. Read-first: persona, módulo, narrativa
 * (quero/para), AC e tasks-filhas (click → TaskSheetByRef). Edição rica fica na
 * aba Stories do projeto. Abre por `storyRef`; fecha em `onClose`.
 */
export function StoryDetailSheet({
  storyRef,
  onClose,
}: {
  storyRef: string | null;
  onClose: () => void;
}) {
  const [data, setData] = useState<{
    story: StoryWithRelations;
    tasks: StoryTask[];
  } | null>(null);
  const [openTaskId, setOpenTaskId] = useState<string | null>(null);

  useEffect(() => {
    if (!storyRef) return;
    let cancelled = false;
    fetch(`/api/stories/${storyRef}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!cancelled) setData(d);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [storyRef]);

  // Mostra o cache só quando bate com o ref aberto (evita flash do anterior).
  const story = data?.story?.reference === storyRef ? data.story : null;
  const tasks = story ? data!.tasks : [];
  const loading = !!storyRef && !story;
  const ov = story?.overview;

  return (
    <>
      <ResponsiveSheet
        open={!!storyRef}
        onOpenChange={(o) => {
          if (!o) onClose();
        }}
      >
        <ResponsiveSheetContent size="md">
          <ResponsiveSheetHeader>
            <ResponsiveSheetTitle className="flex items-center gap-2">
              <span className="font-mono text-xs tabular-nums text-muted-foreground">
                {storyRef}
              </span>
              <span>{story?.title ?? (loading ? "Carregando…" : "")}</span>
            </ResponsiveSheetTitle>
            {story && (
              <ResponsiveSheetDescription className="flex flex-wrap items-center gap-1.5 pt-1">
                <RefinementChip status={story.refinementStatus as RefinementStatus} />
                {ov?.computedStatus && (
                  <ComputedStatusChip status={ov.computedStatus as ComputedStatus} />
                )}
                {story.module && (
                  <Badge variant="outline" className="font-mono text-[10px]">
                    {story.module.name}
                  </Badge>
                )}
                {story.persona && <Badge variant="secondary">{story.persona.name}</Badge>}
              </ResponsiveSheetDescription>
            )}
          </ResponsiveSheetHeader>

          <ResponsiveSheetBody className="space-y-6">
            {loading ? (
              <p className="text-sm text-muted-foreground">Carregando story…</p>
            ) : story ? (
              <>
                {/* Narrativa */}
                <section className="space-y-1">
                  <p className="text-sm leading-relaxed">
                    <span className="text-muted-foreground">Quero </span>
                    {story.want}
                    {story.soThat && (
                      <>
                        <span className="text-muted-foreground"> para </span>
                        {story.soThat}
                      </>
                    )}
                  </p>
                </section>

                {/* Critérios de aceite */}
                <section className="space-y-2">
                  <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    Critérios de aceite ({story.acceptanceCriteria.length})
                  </h3>
                  {story.acceptanceCriteria.length === 0 ? (
                    <p className="text-sm text-muted-foreground">Sem AC ainda.</p>
                  ) : (
                    <ul className="space-y-1.5">
                      {[...story.acceptanceCriteria]
                        .sort((a, b) => a.order - b.order)
                        .map((ac) => (
                          <li key={ac.id} className="flex items-start gap-2 text-sm">
                            {ac.checkedAt ? (
                              <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-emerald-500" />
                            ) : (
                              <Circle className="mt-0.5 size-4 shrink-0 text-muted-foreground/50" />
                            )}
                            <span>{ac.text}</span>
                          </li>
                        ))}
                    </ul>
                  )}
                </section>

                {/* Tasks-filhas */}
                <section className="space-y-2">
                  <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    Tasks ({tasks.length})
                  </h3>
                  {tasks.length === 0 ? (
                    <p className="text-sm text-muted-foreground">
                      Nenhuma task ligada a esta story.
                    </p>
                  ) : (
                    <div className="surface divide-y divide-border/60 overflow-hidden">
                      {tasks.map((t) => {
                        const chip = statusChip(t.status);
                        return (
                          <button
                            key={t.id}
                            type="button"
                            onClick={() => setOpenTaskId(t.id)}
                            className="flex w-full items-start gap-2 px-3 py-2.5 text-left hover:bg-muted/60"
                          >
                            <StatusChip tone={chip.tone} label={chip.label} dot />
                            <span className="min-w-0 flex-1 text-sm">{t.title}</span>
                            {t.functionPoints !== null && (
                              <Badge variant="secondary" className="shrink-0">
                                {t.functionPoints} PFV
                              </Badge>
                            )}
                          </button>
                        );
                      })}
                    </div>
                  )}
                </section>
              </>
            ) : (
              <p className="text-sm text-muted-foreground">Story não encontrada.</p>
            )}
          </ResponsiveSheetBody>
        </ResponsiveSheetContent>
      </ResponsiveSheet>

      {/* Task-filha aberta sobre o sheet da story (read/edição rica). */}
      <TaskSheetByRef taskId={openTaskId} onClose={() => setOpenTaskId(null)} />
    </>
  );
}
