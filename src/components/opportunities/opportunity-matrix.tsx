"use client";

import { OpportunityCard } from "./opportunity-card";
import type { OpportunityRow } from "@/lib/dal/opportunities";

type QuadrantConfig = {
  label: string;
  bgClass: string;
  rule: (impact: number, effort: number) => boolean;
};

const QUADRANTS: QuadrantConfig[] = [
  {
    label: "Quick Wins",
    bgClass: "bg-green-50 dark:bg-green-950/20 border-green-200 dark:border-green-900",
    rule: (impact, effort) => impact >= 4 && effort <= 2,
  },
  {
    label: "Big Bets",
    bgClass: "bg-blue-50 dark:bg-blue-950/20 border-blue-200 dark:border-blue-900",
    rule: (impact, effort) => impact >= 4 && effort >= 3,
  },
  {
    label: "Fill-ins",
    bgClass: "bg-muted/30 border-border",
    rule: (impact, effort) => impact <= 3 && effort <= 2,
  },
  {
    label: "Money Pits",
    bgClass: "bg-destructive/5 dark:bg-destructive/10 border-destructive/20",
    rule: (impact, effort) => impact <= 3 && effort >= 3,
  },
];

const MAX_CARDS_PER_QUADRANT = 5;

export type OpportunityMatrixProps = {
  opportunities: OpportunityRow[];
  onCardClick: (opportunity: OpportunityRow) => void;
};

export function OpportunityMatrix({
  opportunities,
  onCardClick,
}: OpportunityMatrixProps) {
  // Filter out rejected by default (per AC#4)
  const visibleOpportunities = opportunities.filter(
    (opp) => opp.status !== "rejected"
  );

  // Distribute opportunities into quadrants
  const quadrantData = QUADRANTS.map((quadrant) => {
    const items = visibleOpportunities.filter((opp) =>
      quadrant.rule(opp.impact, opp.effort)
    );
    const visible = items.slice(0, MAX_CARDS_PER_QUADRANT);
    const remaining = items.length - visible.length;

    return {
      ...quadrant,
      items: visible,
      remaining,
      total: items.length,
    };
  });

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
      {quadrantData.map((quadrant) => (
        <section
          key={quadrant.label}
          className={`rounded-lg border p-4 space-y-3 ${quadrant.bgClass}`}
        >
          <div className="flex items-center justify-between">
            <h3 className="font-semibold text-sm">{quadrant.label}</h3>
            <span className="text-xs text-muted-foreground">
              {quadrant.total}
            </span>
          </div>

          <div className="space-y-2">
            {quadrant.items.length === 0 ? (
              <p className="text-xs text-muted-foreground italic py-2">
                Nenhuma oportunidade
              </p>
            ) : (
              <>
                {quadrant.items.map((opp) => (
                  <OpportunityCard
                    key={opp.id}
                    opportunity={opp}
                    onClick={() => onCardClick(opp)}
                  />
                ))}
                {quadrant.remaining > 0 && (
                  <button
                    type="button"
                    className="w-full text-xs text-primary hover:underline py-2 text-left"
                    onClick={() => {
                      // In phase 1, this is a placeholder - full list view comes in OPP-013
                      console.log(`See all ${quadrant.total} in ${quadrant.label}`);
                    }}
                  >
                    ver mais ({quadrant.remaining})
                  </button>
                )}
              </>
            )}
          </div>
        </section>
      ))}
    </div>
  );
}
