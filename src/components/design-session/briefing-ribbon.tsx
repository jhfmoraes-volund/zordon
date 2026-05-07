"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ConfirmDialog, type ConfirmState } from "@/components/ui/confirm-dialog";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { BriefingSheet } from "./briefing-sheet";
import {
  CheckCircle2,
  Loader2,
  Flag,
  RotateCcw,
  FileText,
  AlertCircle,
  BookOpen,
} from "lucide-react";

/**
 * Faixa horizontal compacta que vive no topo do briefing step.
 *
 * Concentra três coisas que antes ocupavam três caixas grandes:
 *   1. Stats (stories, tasks, FP) — chips inline
 *   2. Briefing consolidado — botão que abre o BriefingSheet (lateral)
 *   3. Governance — Concluir / Reabrir + blockers via tooltip
 *
 * Modelo "tudo ou nada":
 *   - in_progress: bloqueia "Concluir" se houver pendências; cascata atômica
 *     via POST /api/design-sessions/[id]/complete
 *   - completed: badge + "Reabrir" via POST .../reopen (pre-flight bloqueia
 *     se tasks já saíram do backlog)
 */

type Stats = {
  totalStories: number;
  totalTasks: number;
  totalFp: number;
};

type TreeNode = {
  key: string;
  stories: Array<{ reference: string; tasks: Array<{ id: string }> }>;
};

type TreeData = {
  tree: TreeNode[];
  stats: Stats;
};

type Props = {
  sessionId: string;
  /** Dados consolidados de todos os steps (alimenta o BriefingSheet). */
  briefingData: Record<string, Record<string, unknown>>;
  /** Bump pra forçar re-fetch após mudanças externas. */
  refreshKey?: number;
  /** Notifica o parent quando o status da sessão muda. */
  onStatusChange?: () => void;
};

export function BriefingRibbon({
  sessionId,
  briefingData,
  refreshKey = 0,
  onStatusChange,
}: Props) {
  const [status, setStatus] = useState<string | null>(null);
  const [treeData, setTreeData] = useState<TreeData | null>(null);
  const [completing, setCompleting] = useState(false);
  const [reopening, setReopening] = useState(false);
  const [confirmState, setConfirmState] = useState<ConfirmState | null>(null);
  const [briefingOpen, setBriefingOpen] = useState(false);

  const load = useCallback(async () => {
    const [sessionR, treeR] = await Promise.all([
      fetch(`/api/design-sessions/${sessionId}`),
      fetch(`/api/design-sessions/${sessionId}/tree`),
    ]);
    const sessionJson = await sessionR.json();
    const treeJson = await treeR.json();
    if (sessionR.ok) setStatus(sessionJson.status);
    if (treeR.ok) setTreeData(treeJson);
  }, [sessionId]);

  useEffect(() => {
    load();
  }, [load, refreshKey]);

  const isCompleted = status === "completed";
  const stats = treeData?.stats;

  // Blockers só importam quando ainda em progresso.
  const blockers: string[] = [];
  if (!isCompleted && treeData) {
    const orphan = treeData.tree.find((m) => m.key === "_orphan_");
    if (orphan && orphan.stories.length > 0) {
      blockers.push(
        `${orphan.stories.length} story(s) sem módulo — vincule ou descarte`,
      );
    }
    for (const mod of treeData.tree) {
      for (const s of mod.stories) {
        if (s.tasks.length === 0) {
          blockers.push(`${s.reference}: gere as tasks ou descarte a story`);
        }
      }
    }
  }
  const canComplete = blockers.length === 0;

  const handleComplete = useCallback(async () => {
    if (!canComplete) return;
    setCompleting(true);
    try {
      const res = await fetch(`/api/design-sessions/${sessionId}/complete`, {
        method: "POST",
      });
      const json = await res.json();
      if (!res.ok) {
        toast.error(json.message || json.error || "Falha ao concluir sessão");
        return;
      }
      const summary =
        json.tasksPromoted > 0
          ? `${json.storiesCommitted} story(s), ${json.tasksPromoted} task(s) no backlog (${json.totalFp} FP)`
          : `${json.storiesCommitted} story(s) consolidada(s)`;
      toast.success(`Sessão concluída · ${summary}`);
      await load();
      onStatusChange?.();
    } catch (e) {
      toast.error("Falha ao concluir sessão");
      console.error(e);
    } finally {
      setCompleting(false);
    }
  }, [canComplete, load, onStatusChange, sessionId]);

  const executeReopen = useCallback(async () => {
    setReopening(true);
    try {
      const res = await fetch(`/api/design-sessions/${sessionId}/reopen`, {
        method: "POST",
      });
      const json = await res.json().catch(() => null);
      if (!res.ok) {
        if (res.status === 409 && json?.blocking) {
          const refs = (json.blocking as Array<{
            reference: string | null;
            status: string;
          }>)
            .map((b) => `${b.reference ?? "?"} (${b.status})`)
            .join(", ");
          toast.error(`Bloqueado: ${json.message}. Tasks ativas: ${refs}`);
        } else {
          toast.error(
            json?.message || json?.error || `HTTP ${res.status}: falha ao reabrir`,
          );
        }
        return;
      }
      toast.success(
        `Sessão reaberta · ${json.storiesReverted} story(s) e ${json.tasksReverted} task(s) voltaram a draft`,
      );
      await load();
      onStatusChange?.();
    } catch (e) {
      toast.error("Falha ao reabrir sessão");
      console.error(e);
    } finally {
      setReopening(false);
    }
  }, [load, onStatusChange, sessionId]);

  const requestReopen = useCallback(() => {
    setConfirmState({
      title: "Reabrir sessão?",
      description:
        "Todas as stories voltam para draft, todas as tasks voltam para rascunho " +
        "e os módulos perdem aprovação. Se alguma task já saiu do backlog " +
        "(todo/in_progress/review/done), a operação é bloqueada — resolva essas tasks antes.",
      confirmLabel: "Reabrir",
      destructive: true,
      onConfirm: executeReopen,
    });
  }, [executeReopen]);

  if (status === null) return null;

  return (
    <TooltipProvider delay={150}>
      <div className="border-b bg-card/40 px-4 py-2.5 flex items-center gap-3 flex-wrap">
        {/* Stats inline */}
        {stats && (
          <div className="flex items-center gap-3 text-xs text-muted-foreground">
            <span className="inline-flex items-center gap-1">
              <FileText className="h-3 w-3" />
              <span className="tabular-nums font-medium text-foreground">
                {stats.totalStories}
              </span>
              <span>stories</span>
            </span>
            <span className="text-border">·</span>
            <span className="tabular-nums">
              <span className="font-medium text-foreground">{stats.totalTasks}</span> tasks
            </span>
            <span className="text-border">·</span>
            <span className="tabular-nums">
              <span className="font-medium text-foreground">{stats.totalFp}</span> FP
            </span>
          </div>
        )}

        <div className="h-4 w-px bg-border" />

        {/* Ver briefing */}
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setBriefingOpen(true)}
          className="h-7 text-xs gap-1.5"
        >
          <BookOpen className="h-3.5 w-3.5" />
          Ver briefing
        </Button>

        {/* Spacer */}
        <div className="ml-auto flex items-center gap-2">
          {/* Blockers chip — só quando in_progress e há pendências */}
          {!isCompleted && blockers.length > 0 && (
            <Tooltip>
              <TooltipTrigger
                render={
                  <span className="inline-flex items-center gap-1 text-xs text-amber-700 dark:text-amber-400 px-2 py-1 rounded-md bg-amber-500/10 border border-amber-500/30 cursor-help">
                    <AlertCircle className="h-3 w-3" />
                    {blockers.length} pendência{blockers.length > 1 ? "s" : ""}
                  </span>
                }
              />
              <TooltipContent className="max-w-md">
                <ul className="text-xs space-y-0.5 list-disc list-inside">
                  {blockers.slice(0, 8).map((b, i) => (
                    <li key={i}>{b}</li>
                  ))}
                  {blockers.length > 8 && (
                    <li className="text-muted-foreground">
                      ... +{blockers.length - 8} pendência(s)
                    </li>
                  )}
                </ul>
              </TooltipContent>
            </Tooltip>
          )}

          {/* Governance */}
          {isCompleted ? (
            <>
              <Badge className="bg-green-500/20 text-green-400 gap-1.5">
                <CheckCircle2 className="h-3 w-3" /> Concluída
              </Badge>
              <Button
                variant="outline"
                size="sm"
                onClick={requestReopen}
                disabled={reopening}
                className="h-7 text-xs"
              >
                {reopening ? (
                  <Loader2 className="h-3 w-3 mr-1.5 animate-spin" />
                ) : (
                  <RotateCcw className="h-3 w-3 mr-1.5" />
                )}
                Reabrir sessão
              </Button>
            </>
          ) : (
            <Tooltip>
              <TooltipTrigger
                render={
                  <span>
                    <Button
                      size="sm"
                      onClick={handleComplete}
                      disabled={completing || !canComplete}
                      className="h-7 text-xs"
                    >
                      {completing ? (
                        <Loader2 className="h-3 w-3 mr-1.5 animate-spin" />
                      ) : (
                        <Flag className="h-3 w-3 mr-1.5" />
                      )}
                      Concluir sessão
                    </Button>
                  </span>
                }
              />
              {!canComplete && (
                <TooltipContent>
                  Resolva as pendências pra concluir.
                </TooltipContent>
              )}
            </Tooltip>
          )}
        </div>
      </div>

      <BriefingSheet
        open={briefingOpen}
        onClose={() => setBriefingOpen(false)}
        allData={briefingData}
      />

      <ConfirmDialog state={confirmState} onClose={() => setConfirmState(null)} />
    </TooltipProvider>
  );
}
