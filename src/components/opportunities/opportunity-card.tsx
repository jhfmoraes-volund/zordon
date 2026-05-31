"use client";

import Link from "next/link";
import { StatusChip } from "@/components/ui/status-chip";
import { Badge } from "@/components/ui/badge";
import { lookupChip, type ChipDescriptor } from "@/lib/status-chips";
import type { OpportunityRow } from "@/lib/dal/opportunities";

// Opportunity status registry (following the pattern from status-chips.ts)
const OPPORTUNITY_STATUS: Record<OpportunityRow["status"], ChipDescriptor> = {
  discovery: { label: "Descoberta", tone: "blue" },
  evaluating: { label: "Avaliando", tone: "amber" },
  approved: { label: "Aprovado", tone: "green" },
  in_project: { label: "Em projeto", tone: "purple" },
  rejected: { label: "Rejeitado", tone: "muted" },
};

function calculateScore(impact: number, effort: number): number {
  // Per PRD §D9: score = impact * 5 - effort
  return impact * 5 - effort;
}

export type OpportunityCardProps = {
  opportunity: OpportunityRow;
  onClick: () => void;
};

export function OpportunityCard({
  opportunity,
  onClick,
}: OpportunityCardProps) {
  const score = calculateScore(opportunity.impact, opportunity.effort);
  const statusChip = lookupChip(OPPORTUNITY_STATUS, opportunity.status);

  return (
    <article
      onClick={onClick}
      className="surface block p-4 space-y-3 transition-colors cursor-pointer active:bg-accent/40 hover:border-border/80"
    >
      <div className="space-y-0.5">
        <h3 className="font-medium text-sm leading-tight truncate">
          {opportunity.title}
        </h3>
        {opportunity.description && (
          <p className="text-xs text-muted-foreground line-clamp-1">
            {opportunity.description}
          </p>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <StatusChip {...statusChip} dot />
        <Badge variant="secondary">
          Score: {score}
        </Badge>
      </div>

      {opportunity.promotedProjectId && (
        <div className="text-xs">
          <Link
            href={`/projects/${opportunity.promotedProjectId}`}
            onClick={(e) => e.stopPropagation()}
            className="text-primary hover:underline inline-flex items-center gap-1"
          >
            Ver projeto →
          </Link>
        </div>
      )}
    </article>
  );
}
