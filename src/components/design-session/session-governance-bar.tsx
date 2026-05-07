"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ConfirmDialog, type ConfirmState } from "@/components/ui/confirm-dialog";
import { CheckCircle2, Loader2, Flag, RotateCcw } from "lucide-react";

/**
 * Barra de governance de Design Session — vive no step de briefing.
 *
 * Modelo "tudo ou nada":
 *   - in_progress: bloqueia "Concluir" se houver pendências; ao confirmar,
 *     dispara cascata atômica via POST /api/design-sessions/[id]/complete.
 *   - completed: badge + botão "Reabrir" (POST .../reopen). Pre-flight no
 *     server bloqueia se tasks já saíram do backlog.
 */

type Stats = {
  totalStories: number;
  totalTasks: number;
  draftTasks: number;
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
  /** Bump pra forçar re-fetch do status/árvore após mudanças externas. */
  refreshKey?: number;
  /** Notifica o parent quando o status muda — usado pra rebuild da árvore. */
  onStatusChange?: () => void;
};

export function SessionGovernanceBar({
  sessionId,
  refreshKey = 0,
  onStatusChange,
}: Props) {
  const [status, setStatus] = useState<string | null>(null);
  const [treeData, setTreeData] = useState<TreeData | null>(null);
  const [completing, setCompleting] = useState(false);
  const [reopening, setReopening] = useState(false);
  const [confirmState, setConfirmState] = useState<ConfirmState | null>(null);

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
    <div className="rounded-md border bg-card px-4 py-3 space-y-2">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="text-sm">
          {isCompleted ? (
            <span className="text-muted-foreground">
              Esta sessão está concluída — todas as stories, módulos e tasks
              foram promovidos. Reabra apenas se precisar editar (cuidado:
              cascata reverte tudo).
            </span>
          ) : (
            <span className="text-muted-foreground">
              Concluir esta sessão aprova todos os módulos, commita todas as
              stories e promove todas as tasks pro backlog do projeto. Tudo ou
              nada.
            </span>
          )}
        </div>
        {isCompleted ? (
          <div className="flex items-center gap-2 shrink-0">
            <Badge className="bg-green-500/20 text-green-400 gap-1.5">
              <CheckCircle2 className="h-3 w-3" /> Sessão concluída
            </Badge>
            <Button
              variant="outline"
              size="sm"
              onClick={requestReopen}
              disabled={reopening}
            >
              {reopening ? (
                <Loader2 className="h-3 w-3 mr-2 animate-spin" />
              ) : (
                <RotateCcw className="h-3 w-3 mr-2" />
              )}
              Reabrir sessão
            </Button>
          </div>
        ) : (
          <Button
            onClick={handleComplete}
            disabled={completing || !canComplete}
            title={blockers.join(" · ") || "Concluir sessão"}
            className="shrink-0"
          >
            {completing ? (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            ) : (
              <Flag className="h-4 w-4 mr-2" />
            )}
            Concluir sessão
          </Button>
        )}
      </div>
      {!isCompleted && blockers.length > 0 && (
        <ul className="text-xs text-amber-700 dark:text-amber-400 list-disc list-inside space-y-0.5">
          {blockers.slice(0, 6).map((b, i) => (
            <li key={i}>{b}</li>
          ))}
          {blockers.length > 6 && (
            <li className="text-muted-foreground">
              ... +{blockers.length - 6} pendência(s)
            </li>
          )}
        </ul>
      )}
      <ConfirmDialog state={confirmState} onClose={() => setConfirmState(null)} />
    </div>
  );
}
