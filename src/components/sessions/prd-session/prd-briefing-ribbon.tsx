"use client";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { CheckCheck, FileText, Link2 } from "lucide-react";

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
};

export function PrdBriefingRibbon({
  stats,
  insumosCount,
  onOpenInsumos,
  onApproveAll,
  approving = false,
}: Props) {
  const canApproveAll = stats.draft > 0 && !approving;

  return (
    <TooltipProvider delay={150}>
      <div className="border-b bg-card/40 px-4 py-2.5 flex items-center gap-3 flex-wrap">
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
        <Button
          variant="ghost"
          size="sm"
          onClick={onOpenInsumos}
          className="h-7 text-xs gap-1.5"
        >
          <Link2 className="h-3.5 w-3.5" />
          Insumos
          {insumosCount > 0 && (
            <Badge variant="secondary" className="ml-1 h-4 px-1.5 text-[10px]">
              {insumosCount}
            </Badge>
          )}
        </Button>

        <div className="ml-auto flex items-center gap-2">
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
