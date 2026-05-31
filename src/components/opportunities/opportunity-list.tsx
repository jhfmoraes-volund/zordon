"use client";

import { useState } from "react";
import { ArrowUpRight } from "lucide-react";
import { OpportunityCard } from "./opportunity-card";
import { Button } from "@/components/ui/button";
import type { OpportunityRow } from "@/lib/dal/opportunities";

function calculateScore(impact: number, effort: number): number {
  // Per PRD §D9: score = impact * 5 - effort
  return impact * 5 - effort;
}

function sortOpportunities(
  opportunities: OpportunityRow[],
): OpportunityRow[] {
  // AC#2: priorityRank NULLS LAST, then score DESC, then createdAt DESC
  return [...opportunities].sort((a, b) => {
    // 1. priorityRank NULLS LAST (lower priorityRank comes first)
    if (a.priorityRank !== null && b.priorityRank === null) return -1;
    if (a.priorityRank === null && b.priorityRank !== null) return 1;
    if (a.priorityRank !== null && b.priorityRank !== null) {
      if (a.priorityRank !== b.priorityRank) {
        return a.priorityRank - b.priorityRank;
      }
    }

    // 2. score DESC (higher score comes first)
    const scoreA = calculateScore(a.impact, a.effort);
    const scoreB = calculateScore(b.impact, b.effort);
    if (scoreA !== scoreB) {
      return scoreB - scoreA;
    }

    // 3. createdAt DESC (newer comes first)
    return (
      new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );
  });
}

export type OpportunityListProps = {
  opportunities: OpportunityRow[];
  onCardClick: (opportunity: OpportunityRow) => void;
  onPromote?: (opportunity: OpportunityRow) => void;
};

export function OpportunityList({
  opportunities,
  onCardClick,
  onPromote,
}: OpportunityListProps) {
  // AC#3: Toggle filters status='rejected' (default hidden)
  const [showRejected, setShowRejected] = useState(false);

  const filtered = showRejected
    ? opportunities
    : opportunities.filter((opp) => opp.status !== "rejected");

  const sorted = sortOpportunities(filtered);
  const rejectedCount = opportunities.filter(
    (opp) => opp.status === "rejected",
  ).length;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="text-xs text-muted-foreground">
          <span className="font-mono tabular-nums">{sorted.length}</span>{" "}
          oportunidades
        </div>

        {rejectedCount > 0 && (
          <Button
            size="xs"
            variant="ghost"
            onClick={() => setShowRejected(!showRejected)}
            aria-pressed={showRejected}
          >
            {showRejected ? "Ocultar" : "Mostrar"} descartadas ({rejectedCount})
          </Button>
        )}
      </div>

      <div className="space-y-2">
        {sorted.length === 0 ? (
          <p className="text-sm text-muted-foreground italic py-8 text-center">
            Nenhuma oportunidade
          </p>
        ) : (
          sorted.map((opp) => (
            <div key={opp.id} className="relative">
              <OpportunityCard opportunity={opp} onClick={() => onCardClick(opp)} />

              {/* AC#4: Promote button visible only for status='approved' */}
              {opp.status === "approved" && onPromote && (
                <div className="absolute top-2 right-2">
                  <Button
                    size="xs"
                    variant="default"
                    onClick={(e) => {
                      e.stopPropagation();
                      onPromote(opp);
                    }}
                    aria-label="Promover a projeto"
                  >
                    <ArrowUpRight className="size-3" />
                    Promover
                  </Button>
                </div>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
