"use client";

import Link from "next/link";
import { ArrowLeft, Check, Loader2, Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import { StatusChip } from "@/components/ui/status-chip";
import { fmtDate } from "@/lib/date-utils";
import type { PlanningDetail } from "@/lib/dal/planning";
import { PlanningCostBadge } from "@/components/planning/planning-cost-badge";
import { InsumosButton } from "@/components/agent/context-import";

type Props = {
  planning: PlanningDetail;
  backHref: string;
  /** Stats hierárquicos vindos do PlanningTree (null = ainda carregando). */
  treeStats: {
    modules: number;
    stories: number;
    committedTasks: number;
    eligibleTasks: number;
    committedFp: number | null;
    pendingActions: number;
  } | null;
  concluding: boolean;
  onConclude: () => void;
  onOpenContext: () => void;
  onEdit: () => void;
  /** Thread atual do chat — usado pra exibir custo da sessão (manager+). */
  threadId?: string | null;
};

/**
 * Cabeçalho da Planning no modelo staging-commit.
 *
 * UI mostra só 2 estados ao PM: "Em planejamento" e "Concluída". Em
 * planejamento, único botão de governance é "Concluir planning" — append-only,
 * irreversível.
 */
export function PlanningRibbon({
  planning,
  backHref,
  treeStats,
  concluding,
  onConclude,
  onOpenContext,
  onEdit,
  threadId,
}: Props) {
  const isClosed = planning.phase === "closed" || planning.phase === "archived";

  const title = planning.sprintName
    ? `Planning · ${planning.sprintName}`
    : "Planning";

  return (
    <div className="shrink-0 border-b bg-background px-6 py-3 space-y-2">
      <div className="flex items-center gap-2 flex-wrap">
        <Link href={backHref}>
          <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0">
            <ArrowLeft className="h-4 w-4" />
          </Button>
        </Link>
        <div className="min-w-0 flex-1">
          <h1 className="text-base font-bold truncate">{title}</h1>
          {planning.scheduledFor && (
            <p className="text-xs text-muted-foreground">
              {fmtDate(planning.scheduledFor)}
            </p>
          )}
        </div>

        <StatusChip
          tone={isClosed ? "green" : "blue"}
          label={isClosed ? "Concluída" : "Em planejamento"}
          dot
        />

        <PlanningCostBadge threadId={threadId ?? null} />

        <Button
          size="sm"
          variant="ghost"
          onClick={onEdit}
          className="h-8 w-8 p-0"
          title="Editar Planning"
        >
          <Pencil className="h-3.5 w-3.5" />
        </Button>

        <InsumosButton
          count={planning.linkedTranscriptCount}
          onClick={onOpenContext}
          variant="outline"
          className="h-8"
        />

        {!isClosed && (
          <Button size="sm" disabled={concluding} onClick={onConclude}>
            {concluding ? (
              <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
            ) : (
              <Check className="mr-1.5 h-3.5 w-3.5" />
            )}
            Concluir planning
          </Button>
        )}
      </div>

      <div className="flex items-center gap-3 text-xs text-muted-foreground flex-wrap">
        {treeStats ? (
          <>
            <Stat n={treeStats.modules} label={treeStats.modules === 1 ? "módulo" : "módulos"} />
            <Sep />
            <Stat n={treeStats.stories} label={treeStats.stories === 1 ? "story" : "stories"} />
            <Sep />
            <span>
              <strong className="font-mono tabular-nums text-foreground">
                {treeStats.committedTasks}
              </strong>
              {treeStats.eligibleTasks > 0 && (
                <span className="text-muted-foreground/70">
                  +{treeStats.eligibleTasks}
                </span>
              )}{" "}
              task{treeStats.committedTasks === 1 ? "" : "s"}
            </span>
            {treeStats.committedFp !== null && (
              <>
                <Sep />
                <Stat n={treeStats.committedFp} label="FP" />
              </>
            )}
            {treeStats.pendingActions > 0 && (
              <>
                <Sep />
                <Stat
                  n={treeStats.pendingActions}
                  label={
                    treeStats.pendingActions === 1 ? "proposta" : "propostas"
                  }
                  emphasize
                />
              </>
            )}
          </>
        ) : (
          <span className="text-muted-foreground/70">carregando árvore…</span>
        )}
        {planning.facilitatorName && (
          <>
            <Sep />
            <span>Facilitador: {planning.facilitatorName}</span>
          </>
        )}
      </div>
    </div>
  );
}

function Stat({
  n,
  label,
  emphasize,
}: {
  n: number;
  label: string;
  emphasize?: boolean;
}) {
  return (
    <span>
      <strong
        className={
          emphasize
            ? "font-mono tabular-nums text-amber-700 dark:text-amber-400"
            : "font-mono tabular-nums text-foreground"
        }
      >
        {n}
      </strong>{" "}
      {label}
    </span>
  );
}

function Sep() {
  return (
    <span aria-hidden className="text-muted-foreground/40">
      ·
    </span>
  );
}
