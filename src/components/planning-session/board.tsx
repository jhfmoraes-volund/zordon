"use client";

import { useCallback } from "react";
import { Layers } from "lucide-react";
import { BoardColumn } from "@/components/design-session/board/board-column";
import { StickyCard } from "@/components/design-session/board/sticky-card";
import { useOptimisticCollection, type AnyMutation, type BaseMutation } from "@/hooks/use-optimistic-collection";
import type { PlanningSessionPRDRow } from "@/lib/dal/planning-session";

type PRDMutation =
  | BaseMutation<PlanningSessionPRDRow>
  | {
      type: "drag";
      id: string;
      sprintStart: number;
      order: number;
    };

function prdReducer(
  state: PlanningSessionPRDRow[],
  m: AnyMutation<PlanningSessionPRDRow, PRDMutation>,
): PlanningSessionPRDRow[] {
  if (m.type === "drag") {
    return state.map((p) =>
      p.id === m.id
        ? { ...p, sprintStart: m.sprintStart, order: m.order }
        : p,
    );
  }
  // Base mutations (patch, create, delete, etc)
  return state;
}

type PlanningBoardProps = {
  sessionId: string;
  sprintCount: number;
  prds: PlanningSessionPRDRow[];
  onPrdDrag: (prdId: string, sprintStart: number, order: number) => Promise<void>;
};

export function PlanningBoard({
  sessionId,
  sprintCount,
  prds: initialPrds,
  onPrdDrag,
}: PlanningBoardProps) {
  const { items: prds, mutate } = useOptimisticCollection(
    initialPrds,
    prdReducer,
  );

  const handleDrop = useCallback(
    async (prdId: string, newSprintStart: number) => {
      const currentPrd = prds.find((p) => p.id === prdId);
      if (!currentPrd) return;

      // Calculate new order (append to end of sprint)
      const prdsInSprint = prds.filter((p) => p.sprintStart === newSprintStart);
      const newOrder = prdsInSprint.length > 0
        ? Math.max(...prdsInSprint.map((p) => p.order)) + 1
        : 0;

      await mutate(
        {
          type: "drag",
          id: prdId,
          sprintStart: newSprintStart,
          order: newOrder,
        },
        async (signal) => {
          await onPrdDrag(prdId, newSprintStart, newOrder);
        },
        {
          errorLabel: "Falha ao mover PRD",
          retry: false,
        },
      );
    },
    [prds, mutate, onPrdDrag],
  );

  // Group PRDs by sprint
  const prdsBySprint = new Map<number, PlanningSessionPRDRow[]>();
  for (let i = 1; i <= sprintCount; i++) {
    prdsBySprint.set(i, []);
  }
  for (const prd of prds) {
    const existing = prdsBySprint.get(prd.sprintStart);
    if (existing) {
      existing.push(prd);
    }
  }

  return (
    <div className="grid gap-4" style={{ gridTemplateColumns: `repeat(${Math.min(sprintCount, 4)}, 1fr)` }}>
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
                e.preventDefault();
                e.dataTransfer.dropEffect = "move";
              }}
              onDrop={(e) => {
                e.preventDefault();
                const prdId = e.dataTransfer.getData("prd-id");
                if (prdId) {
                  void handleDrop(prdId, sprintNum);
                }
              }}
            >
              {prdsInSprint.map((prd) => (
                <div
                  key={prd.id}
                  draggable
                  onDragStart={(e) => {
                    e.dataTransfer.effectAllowed = "move";
                    e.dataTransfer.setData("prd-id", prd.id);
                  }}
                  className="cursor-move"
                >
                  <StickyCard
                    accent="sky"
                    collapsed={
                      <div>
                        <div className="font-medium text-sm">{prd.prdSlug}</div>
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
                    }
                  />
                </div>
              ))}
            </div>
          </BoardColumn>
        );
      })}
    </div>
  );
}
