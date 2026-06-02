"use client";

import { useCallback } from "react";
import { Layers, X } from "lucide-react";
import { BoardColumn } from "@/components/design-session/board/board-column";
import { StickyCard } from "@/components/design-session/board/sticky-card";
import { StatusChip } from "@/components/ui/status-chip";
import type { ChipTone } from "@/lib/status-chips";
import {
  useOptimisticCollection,
  type AnyMutation,
  type BaseMutation,
} from "@/hooks/use-optimistic-collection";
import type { PlanningSessionPRDWithSource } from "@/lib/dal/planning-session";

type PRDMutation =
  | BaseMutation<PlanningSessionPRDWithSource>
  | {
      type: "drag";
      id: string;
      sprintStart: number;
      order: number;
    };

function prdReducer(
  state: PlanningSessionPRDWithSource[],
  m: AnyMutation<PlanningSessionPRDWithSource, PRDMutation>,
): PlanningSessionPRDWithSource[] {
  if (m.type === "drag") {
    return state.map((p) =>
      p.id === m.id ? { ...p, sprintStart: m.sprintStart, order: m.order } : p,
    );
  }
  if (m.type === "delete") {
    return state.filter((p) => p.id !== m.id);
  }
  // Outras base mutations (patch, create, etc) — não usadas aqui.
  return state;
}

const PRD_STATUS_TONE: Record<string, ChipTone> = {
  approved: "green",
  review: "blue",
  draft: "muted",
  superseded: "muted",
};

type PlanningBoardProps = {
  sessionId: string;
  sprintCount: number;
  prds: PlanningSessionPRDWithSource[];
  onPrdDrag: (prdId: string, sprintStart: number, order: number) => Promise<void>;
  /** Quando presente, mostra affordance de desvincular no card. */
  onUnlink?: (prdRowId: string) => Promise<void>;
  /** Plano aprovado → board read-only (sem drag/unlink). */
  readOnly?: boolean;
};

export function PlanningBoard({
  sprintCount,
  prds: initialPrds,
  onPrdDrag,
  onUnlink,
  readOnly = false,
}: PlanningBoardProps) {
  const { items: prds, mutate } = useOptimisticCollection(initialPrds, prdReducer);

  const handleDrop = useCallback(
    async (prdId: string, newSprintStart: number) => {
      const currentPrd = prds.find((p) => p.id === prdId);
      if (!currentPrd) return;

      const prdsInSprint = prds.filter((p) => p.sprintStart === newSprintStart);
      const newOrder =
        prdsInSprint.length > 0
          ? Math.max(...prdsInSprint.map((p) => p.order)) + 1
          : 0;

      await mutate(
        { type: "drag", id: prdId, sprintStart: newSprintStart, order: newOrder },
        async () => {
          await onPrdDrag(prdId, newSprintStart, newOrder);
        },
        { errorLabel: "Falha ao mover PRD", retry: false },
      );
    },
    [prds, mutate, onPrdDrag],
  );

  const handleUnlink = useCallback(
    async (prdRowId: string) => {
      if (!onUnlink) return;
      await mutate(
        { type: "delete", id: prdRowId },
        async () => {
          await onUnlink(prdRowId);
        },
        { errorLabel: "Falha ao desvincular PRD", retry: false },
      );
    },
    [mutate, onUnlink],
  );

  // Group PRDs by sprint
  const prdsBySprint = new Map<number, PlanningSessionPRDWithSource[]>();
  for (let i = 1; i <= sprintCount; i++) {
    prdsBySprint.set(i, []);
  }
  for (const prd of prds) {
    prdsBySprint.get(prd.sprintStart)?.push(prd);
  }

  return (
    <div
      className="grid gap-4"
      style={{ gridTemplateColumns: `repeat(${Math.min(sprintCount, 4)}, 1fr)` }}
    >
      {Array.from({ length: sprintCount }, (_, i) => {
        const sprintNum = i + 1;
        const prdsInSprint = prdsBySprint.get(sprintNum) ?? [];

        return (
          <BoardColumn
            key={sprintNum}
            accent="sky"
            icon={<Layers className="size-4" />}
            title={`Sprint ${sprintNum}`}
            count={prdsInSprint.length}
            countLabel="PRD"
            className="min-h-[300px]"
          >
            <div
              className="space-y-2.5"
              onDragOver={(e) => {
                if (readOnly) return;
                e.preventDefault();
                e.dataTransfer.dropEffect = "move";
              }}
              onDrop={(e) => {
                if (readOnly) return;
                e.preventDefault();
                const prdId = e.dataTransfer.getData("prd-id");
                if (prdId) void handleDrop(prdId, sprintNum);
              }}
            >
              {prdsInSprint.map((prd) => {
                const req = prd.productRequirement;
                const title = req ? req.title : (prd.prdSlug ?? "(?)");
                return (
                  <div
                    key={prd.id}
                    draggable={!readOnly}
                    onDragStart={(e) => {
                      if (readOnly) return;
                      e.dataTransfer.effectAllowed = "move";
                      e.dataTransfer.setData("prd-id", prd.id);
                    }}
                    className={readOnly ? "" : "cursor-move"}
                  >
                    <StickyCard
                      accent="sky"
                      collapsed={
                        <div className="group/card">
                          <div className="flex items-start justify-between gap-2">
                            <div className="min-w-0">
                              {req && (
                                <div className="mb-1 flex items-center gap-1.5">
                                  <span className="font-mono text-[10px] text-muted-foreground">
                                    {req.reference}
                                  </span>
                                  <StatusChip
                                    tone={PRD_STATUS_TONE[req.status] ?? "muted"}
                                  >
                                    {req.status}
                                  </StatusChip>
                                </div>
                              )}
                              <div className="text-sm font-medium">{title}</div>
                              {prd.agentJustification && (
                                <div className="mt-1 text-xs text-muted-foreground">
                                  {prd.agentJustification}
                                </div>
                              )}
                              {prd.ownerOverride && (
                                <div className="mt-1 text-xs italic text-amber-600 dark:text-amber-400">
                                  Override: {prd.ownerOverride}
                                </div>
                              )}
                            </div>
                            {!readOnly && onUnlink && (
                              <button
                                type="button"
                                aria-label="Desvincular PRD"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  void handleUnlink(prd.id);
                                }}
                                className="shrink-0 rounded p-0.5 text-muted-foreground opacity-0 transition-opacity hover:bg-destructive/10 hover:text-destructive group-hover/card:opacity-100"
                              >
                                <X className="size-3.5" />
                              </button>
                            )}
                          </div>
                        </div>
                      }
                    />
                  </div>
                );
              })}
            </div>
          </BoardColumn>
        );
      })}
    </div>
  );
}
