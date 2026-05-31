"use client";

import Link from "next/link";
import { useState } from "react";
import { ArrowUpRight } from "lucide-react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { StatusChip } from "@/components/ui/status-chip";
import { Button } from "@/components/ui/button";
import { lookupChip, type ChipDescriptor } from "@/lib/status-chips";
import { fmtDate } from "@/lib/date-utils";
import { cn } from "@/lib/utils";
import type { OpportunityRow } from "@/lib/dal/opportunities";

const OPPORTUNITY_STATUS: Record<OpportunityRow["status"], ChipDescriptor> = {
  discovery: { label: "Descoberta", tone: "blue" },
  evaluating: { label: "Avaliando", tone: "amber" },
  approved: { label: "Aprovado", tone: "green" },
  in_project: { label: "Em projeto", tone: "purple" },
  rejected: { label: "Rejeitado", tone: "muted" },
};

function calculateScore(impact: number, effort: number): number {
  return impact * 5 - effort;
}

function sortOpportunities(opportunities: OpportunityRow[]): OpportunityRow[] {
  return [...opportunities].sort((a, b) => {
    if (a.priorityRank !== null && b.priorityRank === null) return -1;
    if (a.priorityRank === null && b.priorityRank !== null) return 1;
    if (a.priorityRank !== null && b.priorityRank !== null) {
      if (a.priorityRank !== b.priorityRank) {
        return a.priorityRank - b.priorityRank;
      }
    }
    const scoreA = calculateScore(a.impact, a.effort);
    const scoreB = calculateScore(b.impact, b.effort);
    if (scoreA !== scoreB) return scoreB - scoreA;
    return (
      new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );
  });
}

export type OpportunityTableProps = {
  opportunities: OpportunityRow[];
  onRowClick: (opportunity: OpportunityRow) => void;
  onPromote?: (opportunity: OpportunityRow) => void;
};

export function OpportunityTable({
  opportunities,
  onRowClick,
  onPromote,
}: OpportunityTableProps) {
  const [showRejected, setShowRejected] = useState(false);

  const filtered = showRejected
    ? opportunities
    : opportunities.filter((opp) => opp.status !== "rejected");
  const sorted = sortOpportunities(filtered);
  const rejectedCount = opportunities.filter(
    (opp) => opp.status === "rejected",
  ).length;

  return (
    <div className="surface overflow-hidden">
      <div className="flex items-center justify-between px-4 py-2 border-b">
        <div className="text-xs text-muted-foreground">
          <span className="font-mono tabular-nums">{sorted.length}</span>{" "}
          {sorted.length === 1 ? "oportunidade" : "oportunidades"}
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

      {sorted.length === 0 ? (
        <p className="text-sm text-muted-foreground italic py-8 text-center">
          Nenhuma oportunidade
        </p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="min-w-56">Nome</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right w-14">Imp</TableHead>
              <TableHead className="text-right w-14">Esf</TableHead>
              <TableHead className="text-right w-16">Score</TableHead>
              <TableHead className="w-28">Criada</TableHead>
              <TableHead className="w-32 text-right">Ações</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {sorted.map((opp) => {
              const score = calculateScore(opp.impact, opp.effort);
              const statusChip = lookupChip(OPPORTUNITY_STATUS, opp.status);
              return (
                <TableRow
                  key={opp.id}
                  className={cn(
                    "cursor-pointer hover:bg-accent/40",
                    opp.status === "rejected" && "opacity-60",
                  )}
                  onClick={() => onRowClick(opp)}
                >
                  <TableCell className="font-medium">
                    <div className="truncate max-w-[28rem]">{opp.title}</div>
                    {opp.description ? (
                      <div className="text-xs text-muted-foreground line-clamp-1 max-w-[28rem]">
                        {opp.description}
                      </div>
                    ) : null}
                  </TableCell>
                  <TableCell>
                    <StatusChip {...statusChip} dot size="sm" />
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {opp.impact}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {opp.effort}
                  </TableCell>
                  <TableCell className="text-right font-semibold tabular-nums">
                    {score}
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                    {fmtDate(opp.createdAt)}
                  </TableCell>
                  <TableCell
                    className="text-right"
                    onClick={(e) => e.stopPropagation()}
                  >
                    {opp.status === "approved" && onPromote ? (
                      <Button
                        size="xs"
                        variant="default"
                        onClick={() => onPromote(opp)}
                      >
                        <ArrowUpRight className="size-3" />
                        Promover
                      </Button>
                    ) : opp.promotedProjectId ? (
                      <Link
                        href={`/projects/${opp.promotedProjectId}`}
                        className="text-xs text-primary hover:underline inline-flex items-center gap-1"
                        onClick={(e) => e.stopPropagation()}
                      >
                        Ver projeto →
                      </Link>
                    ) : null}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      )}
    </div>
  );
}
