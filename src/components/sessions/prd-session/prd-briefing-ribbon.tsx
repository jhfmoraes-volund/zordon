"use client";

import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { CheckCheck, FileText, Undo2 } from "lucide-react";
import { InsumosButton } from "@/components/agent/context-import";

/**
 * Ribbon enxuto pro PrdBriefingStep.
 *
 * Equivalente conceitual ao `BriefingRibbon` da Inception, mas a unidade de
 * trabalho aqui é PRD (ProductRequirement), não Module/Story/Task. Mostra:
 *   • Stats inline: total · ready · draft
 *   • Botão Insumos (n transcripts/files)
 *   • Botão "Enviar pra Forja" (disabled se houver PRD em draft)
 */

type PrdStats = {
  total: number;
  ready: number;
  draft: number;
};

type Props = {
  stats: PrdStats;
  insumosCount: number;
  onOpenInsumos: () => void;
  onApproveAll?: () => void;
  approving?: boolean;
  onDemoteAll?: () => void;
  demoting?: boolean;
};

export function PrdBriefingRibbon({
  stats,
  insumosCount,
  onOpenInsumos,
  onApproveAll,
  approving = false,
  onDemoteAll,
  demoting = false,
}: Props) {
  const canApproveAll = stats.draft > 0 && !approving;
  const canDemoteAll = stats.ready > 0 && !demoting;

  return (
    <TooltipProvider delay={150}>
      <div className="border-b bg-card/40 px-6 py-2.5 flex items-center gap-3 flex-wrap">
        {/* Stats inline */}
        <div className="flex items-center gap-3 text-xs text-muted-foreground">
          <span className="inline-flex items-center gap-1">
            <FileText className="h-3 w-3" />
            <span className="tabular-nums font-medium text-foreground">
              {stats.total}
            </span>
            <span>PRDs</span>
          </span>
          <span className="text-border">·</span>
          <span className="tabular-nums">
            <span className="font-medium text-emerald-600 dark:text-emerald-400">
              {stats.ready}
            </span>{" "}
            ready
          </span>
          <span className="text-border">·</span>
          <span className="tabular-nums">
            <span className="font-medium text-amber-600 dark:text-amber-400">
              {stats.draft}
            </span>{" "}
            draft
          </span>
        </div>

        <div className="h-4 w-px bg-border" />

        {/* Insumos */}
        <InsumosButton
          count={insumosCount}
          onClick={onOpenInsumos}
          variant="ghost"
          className="h-7 text-xs"
        />

        <div className="ml-auto flex items-center gap-2">
          {onDemoteAll && (
            <Tooltip>
              <TooltipTrigger
                render={
                  <span>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={onDemoteAll}
                      disabled={!canDemoteAll}
                      className="h-7 text-xs"
                    >
                      <Undo2 className="h-3 w-3 mr-1.5" />
                      {demoting ? "Despromovendo…" : `Despromover todos${stats.ready > 0 ? ` (${stats.ready})` : ""}`}
                    </Button>
                  </span>
                }
              />
              {stats.ready === 0 && (
                <TooltipContent>
                  Nenhum PRD aprovado pra despromover.
                </TooltipContent>
              )}
            </Tooltip>
          )}
          {onApproveAll && (
            <Tooltip>
              <TooltipTrigger
                render={
                  <span>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={onApproveAll}
                      disabled={!canApproveAll}
                      className="h-7 text-xs"
                    >
                      <CheckCheck className="h-3 w-3 mr-1.5" />
                      {approving ? "Aprovando…" : `Aprovar todos${stats.draft > 0 ? ` (${stats.draft})` : ""}`}
                    </Button>
                  </span>
                }
              />
              {stats.draft === 0 && (
                <TooltipContent>
                  Nenhum PRD em draft pra aprovar.
                </TooltipContent>
              )}
            </Tooltip>
          )}
        </div>
      </div>
    </TooltipProvider>
  );
}
