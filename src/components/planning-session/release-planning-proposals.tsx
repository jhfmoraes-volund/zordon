"use client";

import { useCallback, useEffect, useState } from "react";
import { Check, Loader2, RotateCcw, Sparkles, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ConfirmDialog, type ConfirmState } from "@/components/ui/confirm-dialog";
import { fetchOrThrow, showErrorToast } from "@/lib/optimistic/toast";
import { toast } from "sonner";
import type { PlanningAction } from "@/components/planning/proposal-card";

/** PlanningAction com o embed de sprint destino que o GET /actions devolve. */
type ProposalRow = PlanningAction & {
  targetSprint?: { id: string; name: string } | null;
};

const TYPE_LABEL: Record<string, string> = {
  create: "criar",
  update: "atualizar",
  delete: "remover",
  move: "mover",
  review: "revisar",
};

/**
 * Painel de propostas de task/story do Release Planning unificado.
 *
 * As propostas vivem como MeetingTaskAction na companion ceremony (sprintId
 * NULL) ligada à PlanningSession. O modelo de commit é o mesmo da Sprint
 * Planning: descartar (decision=rejected) tira do lote; "Aplicar" conclui a
 * companion (auto-aprova + aplica em cascata as pendentes) e a fecha — o
 * próximo lote ganha uma companion fresca.
 */
export function ReleasePlanningProposals({
  planningCeremonyId,
  refreshKey,
  onApplied,
  readOnly = false,
}: {
  planningCeremonyId: string | null;
  refreshKey: number;
  onApplied: () => void;
  readOnly?: boolean;
}) {
  const [actions, setActions] = useState<ProposalRow[]>([]);
  const [applying, setApplying] = useState(false);
  const [confirmState, setConfirmState] = useState<ConfirmState | null>(null);

  useEffect(() => {
    if (!planningCeremonyId) {
      setActions([]);
      return;
    }
    let cancelled = false;
    fetch(`/api/planning/${planningCeremonyId}/actions`)
      .then((r) => (r.ok ? r.json() : []))
      .then((data: ProposalRow[]) => {
        if (cancelled) return;
        // Lote de staging = ainda não aplicadas.
        setActions((data ?? []).filter((a) => a.execution === "pending"));
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [planningCeremonyId, refreshKey]);

  const setDecision = useCallback(
    async (actionId: string, decision: "pending" | "rejected") => {
      if (!planningCeremonyId) return;
      const prev = actions;
      // Otimista: reflete a decisão na hora; reverte se o PUT falhar.
      setActions((list) =>
        list.map((a) => (a.id === actionId ? { ...a, decision } : a)),
      );
      try {
        await fetchOrThrow(
          `/api/planning/${planningCeremonyId}/actions/${actionId}`,
          {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ decision }),
          },
        );
      } catch (err) {
        setActions(prev);
        showErrorToast(err, { label: "Falha ao atualizar proposta" });
      }
    },
    [planningCeremonyId, actions],
  );

  const pendingCount = actions.filter((a) => a.decision !== "rejected").length;

  const handleApply = useCallback(() => {
    if (!planningCeremonyId || pendingCount === 0) return;
    setConfirmState({
      title: `Aplicar ${pendingCount} proposta${pendingCount === 1 ? "" : "s"}?`,
      description:
        "As propostas não-descartadas viram Tasks de verdade (com FP, sprint e — no backfill — já concluídas). Append-only e irreversível. As descartadas são ignoradas.",
      confirmLabel: "Aplicar",
      onConfirm: async () => {
        setApplying(true);
        try {
          const res = await fetchOrThrow(
            `/api/planning/${planningCeremonyId}/complete`,
            { method: "POST" },
          );
          const result = (await res.json()) as {
            applied?: number;
            failed?: number;
          };
          toast.success(
            `${result.applied ?? 0} aplicada${result.applied === 1 ? "" : "s"}` +
              (result.failed ? ` · ${result.failed} falhou` : ""),
          );
          onApplied();
        } catch (err) {
          showErrorToast(err, { label: "Falha ao aplicar propostas" });
        } finally {
          setApplying(false);
        }
      },
    });
  }, [planningCeremonyId, pendingCount, onApplied]);

  if (actions.length === 0) return null;

  return (
    <div className="rounded-lg border bg-card">
      <div className="flex items-center justify-between gap-2 border-b px-3 py-2">
        <div className="flex items-center gap-2 text-sm font-medium">
          <Sparkles className="size-4 text-muted-foreground" />
          Propostas de tasks
          <Badge variant="secondary">{pendingCount}</Badge>
        </div>
        {!readOnly && (
          <Button size="sm" onClick={handleApply} disabled={applying || pendingCount === 0}>
            {applying ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Check className="size-4" />
            )}
            Aplicar {pendingCount}
          </Button>
        )}
      </div>

      <ul className="divide-y">
        {actions.map((a) => {
          const payload = a.payload ?? {};
          const title =
            (typeof payload.title === "string" && payload.title) ||
            a.task?.title ||
            "(sem título)";
          const fp =
            typeof payload.functionPoints === "number"
              ? payload.functionPoints
              : null;
          const isDone = payload.status === "done";
          const dueDate =
            typeof payload.dueDate === "string" ? payload.dueDate : null;
          const rejected = a.decision === "rejected";

          return (
            <li
              key={a.id}
              className={`flex items-start gap-3 px-3 py-2.5 ${rejected ? "opacity-50" : ""}`}
            >
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-1.5">
                  <Badge variant="outline">{TYPE_LABEL[a.type] ?? a.type}</Badge>
                  <span
                    className={`truncate text-sm font-medium ${rejected ? "line-through" : ""}`}
                  >
                    {title}
                  </span>
                </div>
                <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                  {fp !== null && <Badge variant="secondary">{fp} FP</Badge>}
                  {isDone && <Badge variant="outline">concluída</Badge>}
                  {a.targetSprint?.name && <span>· {a.targetSprint.name}</span>}
                  {dueDate && <span>· {dueDate}</span>}
                </div>
                {a.aiReasoning && (
                  <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">
                    {a.aiReasoning}
                  </p>
                )}
              </div>

              {!readOnly &&
                (rejected ? (
                  <Button
                    size="icon-sm"
                    variant="ghost"
                    title="Restaurar"
                    onClick={() => setDecision(a.id, "pending")}
                  >
                    <RotateCcw className="size-4" />
                  </Button>
                ) : (
                  <Button
                    size="icon-sm"
                    variant="ghost"
                    title="Descartar"
                    onClick={() => setDecision(a.id, "rejected")}
                  >
                    <X className="size-4" />
                  </Button>
                ))}
            </li>
          );
        })}
      </ul>

      <ConfirmDialog state={confirmState} onClose={() => setConfirmState(null)} />
    </div>
  );
}
