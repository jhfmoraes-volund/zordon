"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Check, ChevronDown, Loader2, RotateCcw, Sparkles, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { StatusChip } from "@/components/ui/status-chip";
import { TASK_STATUS } from "@/lib/status-chips";
import { ConfirmDialog, type ConfirmState } from "@/components/ui/confirm-dialog";
import { MeetingTaskActionSheet } from "@/components/meetings/meeting-task-action-sheet";
import type { MeetingTaskAction } from "@/components/meetings/meeting-task-action-sheet";
import { TaskSheetByRef } from "@/components/task-sheet-by-ref";
import { fetchOrThrow, showErrorToast } from "@/lib/optimistic/toast";
import { toast } from "sonner";
import type { PlanningAction } from "@/components/planning/proposal-card";

/** PlanningAction com o embed de sprint destino que o GET /actions devolve. */
type ProposalRow = PlanningAction & {
  targetSprint?: { id: string; name: string } | null;
};

/** Task real do projeto = o board VIVO (qualquer status, não só done). */
type BoardTask = {
  id: string;
  reference: string | null;
  title: string;
  status: string;
  sprintId: string | null;
  sprintName: string | null;
  sprintStartDate: string | null;
  sprintEndDate: string | null;
  functionPoints: number | null;
  assignees: string[];
};

/** Grupo por sprint: propostas em staging + tasks reais do board vivo. */
type SprintGroup = {
  sprintId: string | null;
  sprintName: string | null;
  sprintStartDate: string | null;
  sprintEndDate: string | null;
  proposals: ProposalRow[];
  tasks: BoardTask[];
};

const TYPE_LABEL: Record<string, string> = {
  create: "criar",
  update: "atualizar",
  delete: "remover",
  move: "mover",
  review: "revisar",
};

const NONE_KEY = "__none__";

/** "16–22 jun" (mesmo mês) ou "30 jun – 6 jul" — janela seg→dom da sprint. */
function formatSprintWeek(start: string | null, end: string | null): string | null {
  if (!start || !end) return null;
  // Parse local (T00:00:00) pra evitar o drift de UTC do `new Date("YYYY-MM-DD")`.
  const s = new Date(`${start}T00:00:00`);
  const e = new Date(`${end}T00:00:00`);
  if (Number.isNaN(s.getTime()) || Number.isNaN(e.getTime())) return null;
  const mon = (d: Date) =>
    d.toLocaleDateString("pt-BR", { month: "short" }).replace(".", "");
  return s.getMonth() === e.getMonth()
    ? `${s.getDate()}–${e.getDate()} ${mon(e)}`
    : `${s.getDate()} ${mon(s)} – ${e.getDate()} ${mon(e)}`;
}

/** Descritor de status com fallback pra valor desconhecido. */
function statusChip(status: string): { label: string; tone: Parameters<typeof StatusChip>[0]["tone"] } {
  const desc = TASK_STATUS[status as keyof typeof TASK_STATUS];
  return desc ?? { label: status, tone: "muted" };
}

/**
 * Painel do Release Planning, agrupado por sprint. Mostra DOIS planos:
 *
 *  • **Board vivo** (Fase 2.0): TODAS as tasks reais do projeto por sprint, com
 *    status e PFV atuais. É o substrato — "build on the live board". Substitui o
 *    antigo extrato só-de-done, que deixava o canvas vazio num projeto cujas
 *    tasks ainda são `todo` (caso SILFAE).
 *  • **Staging**: propostas (MeetingTaskAction) ainda pendentes na companion
 *    ceremony. Descartar tira do lote; "Aplicar" conclui a companion (auto-aprova
 *    + cascata) e fecha.
 *
 * Interação rica: click numa proposta → `MeetingTaskActionSheet`; click numa task
 * do board → `TaskSheetByRef`.
 */
export function ReleasePlanningProposals({
  planningCeremonyId,
  projectId,
  refreshKey,
  onApplied,
  onStateChange,
  readOnly = false,
  agentBusy = false,
}: {
  planningCeremonyId: string | null;
  projectId: string;
  refreshKey: number;
  /** Resultado do apply — a página decide o que fazer (ex: só reseta o chat se
   *  algo foi aplicado de fato). */
  onApplied: (result: { applied: number; failed: number; skipped: number }) => void;
  /** Reporta os counts — a página deriva a fase do header e o empty-state.
   *  `planCount` = tasks no board vivo; `doneCount` = quantas dessas done. */
  onStateChange?: (s: {
    pendingCount: number;
    planCount: number;
    doneCount: number;
  }) => void;
  readOnly?: boolean;
  /** Vitoria ainda gerando no background (turno em vôo). Enquanto isso, o
   *  staging pode estar meio-escrito (tool propose_* no meio do lote) — trava o
   *  "Aplicar" pra não commitar um batch incompleto. */
  agentBusy?: boolean;
}) {
  const [actions, setActions] = useState<ProposalRow[]>([]);
  const [boardTasks, setBoardTasks] = useState<BoardTask[]>([]);
  const [applying, setApplying] = useState(false);
  const [confirmState, setConfirmState] = useState<ConfirmState | null>(null);
  const [openAction, setOpenAction] = useState<ProposalRow | null>(null);
  const [openTaskId, setOpenTaskId] = useState<string | null>(null);
  // Sprints colapsadas (por sprintId / NONE_KEY). Vazio = tudo expandido.
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  const toggleCollapse = useCallback((key: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  const loadAll = useCallback(async () => {
    if (!planningCeremonyId) {
      setActions([]);
      setBoardTasks([]);
      return;
    }
    try {
      const actsRes = await fetch(`/api/planning/${planningCeremonyId}/actions`);
      const acts: ProposalRow[] = actsRes.ok ? await actsRes.json() : [];
      // Staging = pendentes (rejeitadas-pendentes aparecem riscadas pra restaurar).
      const pending = (acts ?? []).filter((a) => a.execution === "pending");
      setActions(pending);

      // Board VIVO = todas as Tasks do projeto (a /api/tasks já exclui draft +
      // dismissed), agrupadas por sprint. NÃO filtra por status nem por companion:
      // o plano é o estado atual do board (todo/in_progress/done/…), não só o que
      // foi entregue. (Atribuição fina por release planning fica pra quando
      // companion↔session for linkado.)
      const tasksRes = await fetch(`/api/tasks?projectId=${projectId}`);
      if (!tasksRes.ok) {
        setBoardTasks([]);
        return;
      }
      const rows = (await tasksRes.json()) as Array<{
        id: string;
        reference: string | null;
        title: string;
        status: string;
        sprintId: string | null;
        functionPoints: number | null;
        sprint?: { name: string; startDate?: string; endDate?: string } | null;
        assignments?: Array<{ member?: { name: string } | null }> | null;
      }>;
      setBoardTasks(
        (rows ?? []).map((t) => ({
          id: t.id,
          reference: t.reference,
          title: t.title,
          status: t.status,
          sprintId: t.sprintId,
          sprintName: t.sprint?.name ?? null,
          sprintStartDate: t.sprint?.startDate ?? null,
          sprintEndDate: t.sprint?.endDate ?? null,
          functionPoints: t.functionPoints,
          assignees: (t.assignments ?? [])
            .map((a) => a.member?.name)
            .filter((n): n is string => !!n),
        })),
      );
    } catch {
      // silencioso — painel apenas não renderiza
    }
  }, [planningCeremonyId, projectId]);

  useEffect(() => {
    void loadAll();
  }, [loadAll, refreshKey]);

  // Reporta os counts pra página derivar a fase do header e o empty-state.
  const pendingCountForState = actions.filter((a) => a.decision !== "rejected").length;
  const doneCountForState = useMemo(
    () => boardTasks.filter((t) => t.status === "done").length,
    [boardTasks],
  );
  useEffect(() => {
    onStateChange?.({
      pendingCount: pendingCountForState,
      planCount: boardTasks.length,
      doneCount: doneCountForState,
    });
  }, [pendingCountForState, boardTasks.length, doneCountForState, onStateChange]);

  const setDecision = useCallback(
    async (actionId: string, decision: "pending" | "rejected") => {
      if (!planningCeremonyId) return;
      const prev = actions;
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

  // ── Agrupa propostas + tasks do board por sprint ────────────────────────
  const groups = useMemo<SprintGroup[]>(() => {
    const map = new Map<string, SprintGroup>();
    const ensure = (
      id: string | null,
      name: string | null,
      start?: string | null,
      end?: string | null,
    ) => {
      const key = id ?? NONE_KEY;
      let g = map.get(key);
      if (!g) {
        g = {
          sprintId: id,
          sprintName: name,
          sprintStartDate: start ?? null,
          sprintEndDate: end ?? null,
          proposals: [],
          tasks: [],
        };
        map.set(key, g);
      } else {
        // Propostas vêm sem datas; a primeira task do board preenche a janela.
        if (!g.sprintName && name) g.sprintName = name;
        if (!g.sprintStartDate && start) g.sprintStartDate = start;
        if (!g.sprintEndDate && end) g.sprintEndDate = end;
      }
      return g;
    };
    for (const a of actions) {
      const id = a.targetSprint?.id ?? a.targetSprintId ?? null;
      ensure(id, a.targetSprint?.name ?? null).proposals.push(a);
    }
    for (const t of boardTasks) {
      ensure(t.sprintId, t.sprintName, t.sprintStartDate, t.sprintEndDate).tasks.push(t);
    }
    const arr = Array.from(map.values());
    arr.sort((a, b) => {
      if (a.sprintId === null) return 1;
      if (b.sprintId === null) return -1;
      return (a.sprintName ?? "").localeCompare(b.sprintName ?? "", undefined, {
        numeric: true,
      });
    });
    return arr;
  }, [actions, boardTasks]);

  const handleApply = useCallback(() => {
    if (!planningCeremonyId || pendingCount === 0 || agentBusy) return;
    setConfirmState({
      title: `Aplicar ${pendingCount} proposta${pendingCount === 1 ? "" : "s"}?`,
      description:
        "As propostas não-descartadas viram Tasks de verdade (com PFV, sprint e — no backfill — já concluídas). As descartadas são ignoradas. Você pode re-planejar a qualquer momento — o board vivo é a base.",
      confirmLabel: "Aplicar",
      onConfirm: async () => {
        setApplying(true);
        try {
          // Timeout generoso: o apply em lote roda em ~2-3s, mas se o request
          // pendurar (server travado/conexão caída) o AbortController dispara,
          // o botão reseta e um toast claro aparece — em vez de congelar até o
          // usuário dar hard refresh (sintoma original).
          const res = await fetchOrThrow(
            `/api/planning/${planningCeremonyId}/complete`,
            { method: "POST" },
            { timeoutMs: 90_000 },
          );
          const result = (await res.json()) as {
            applied?: { applied?: number; failed?: number; skipped?: number };
          };
          const applied = result.applied?.applied ?? 0;
          const failed = result.applied?.failed ?? 0;
          const skipped = result.applied?.skipped ?? 0;
          // Mostra TODAS as contagens — sem isto, propostas puladas (D4/duplicata)
          // somem da tela sem explicação e o PM acha que bugou (achado #1).
          const parts = [`${applied} aplicada${applied === 1 ? "" : "s"}`];
          if (skipped) parts.push(`${skipped} pulada${skipped === 1 ? "" : "s"} (trabalho em curso ou duplicata)`);
          if (failed) parts.push(`${failed} falhou`);
          const msg = parts.join(" · ");
          if (failed && !applied) toast.error(msg);
          else if (skipped || failed) toast.warning(msg);
          else toast.success(msg);
          onApplied({ applied, failed, skipped });
        } catch (err) {
          showErrorToast(err, { label: "Falha ao aplicar propostas" });
        } finally {
          setApplying(false);
        }
      },
    });
  }, [planningCeremonyId, pendingCount, onApplied, agentBusy]);

  if (actions.length === 0 && boardTasks.length === 0) return null;

  const planCount = boardTasks.length;
  const isStaging = pendingCount > 0;

  return (
    <div className="rounded-lg border bg-card">
      <div className="flex items-center justify-between gap-2 border-b px-3 py-2">
        <div className="flex items-center gap-2 text-sm font-medium">
          <Sparkles className="size-4 text-muted-foreground" />
          {isStaging ? "Propostas de tasks" : "Plano (board vivo)"}
          <Badge variant="secondary">{isStaging ? pendingCount : planCount}</Badge>
        </div>
        {!readOnly && isStaging && (
          <Button
            size="sm"
            onClick={handleApply}
            disabled={applying || agentBusy}
            title={
              agentBusy
                ? "Aguarde a Vitoria terminar de montar o plano"
                : undefined
            }
          >
            {applying || agentBusy ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Check className="size-4" />
            )}
            {agentBusy ? "Vitoria montando…" : `Aplicar ${pendingCount}`}
          </Button>
        )}
      </div>

      <div>
        {groups.map((g) => {
          const key = g.sprintId ?? NONE_KEY;
          const isCollapsed = collapsed.has(key);
          const week = formatSprintWeek(g.sprintStartDate, g.sprintEndDate);
          const propCount = g.proposals.filter((p) => p.decision !== "rejected").length;
          const fpTotal = g.tasks.reduce((sum, t) => sum + (t.functionPoints ?? 0), 0);
          const summary = [
            propCount > 0 ? `${propCount} proposta${propCount === 1 ? "" : "s"}` : null,
            g.tasks.length > 0
              ? `${g.tasks.length} task${g.tasks.length === 1 ? "" : "s"} · ${fpTotal} PFV`
              : null,
          ]
            .filter(Boolean)
            .join(" · ");
          return (
            <section key={key} className="border-t first:border-t-0">
              <button
                type="button"
                onClick={() => toggleCollapse(key)}
                aria-expanded={!isCollapsed}
                className="flex w-full items-center gap-2 border-b bg-muted px-3 py-2 text-left hover:bg-muted/70"
              >
                <ChevronDown
                  className={`size-3.5 shrink-0 text-muted-foreground transition-transform ${isCollapsed ? "-rotate-90" : ""}`}
                />
                <span className="text-xs font-semibold uppercase tracking-wide text-foreground">
                  {g.sprintName ?? "Sem sprint"}
                </span>
                {week && (
                  <Badge variant="outline" className="font-normal">
                    {week}
                  </Badge>
                )}
                {summary && (
                  <span className="ml-auto font-mono text-xs text-muted-foreground">
                    {summary}
                  </span>
                )}
              </button>

              {/* Board VIVO desta sprint (qualquer status). Sem cap — espelha o
                  canvas histórico, que renderiza todas as tasks. */}
              {!isCollapsed && g.tasks.map((t) => {
                const chip = statusChip(t.status);
                return (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => setOpenTaskId(t.id)}
                    className="flex w-full flex-col gap-1 px-3 py-2 text-left hover:bg-accent/40"
                  >
                    <div className="flex w-full items-start gap-2">
                      <StatusChip tone={chip.tone} label={chip.label} dot />
                      <span className="line-clamp-2 text-sm">{t.title}</span>
                    </div>
                    {(t.functionPoints !== null || t.assignees.length > 0) && (
                      <div className="flex items-center gap-2">
                        {t.functionPoints !== null && (
                          <Badge variant="secondary" className="shrink-0">
                            {t.functionPoints} PFV
                          </Badge>
                        )}
                        {t.assignees.length > 0 && (
                          <span className="shrink-0 text-xs text-muted-foreground">
                            @{t.assignees.join(", ")}
                          </span>
                        )}
                      </div>
                    )}
                  </button>
                );
              })}

              {/* Propostas em staging (click → sheet rico) */}
              {!isCollapsed && g.proposals.map((a) => {
                const payload = a.payload ?? {};
                const title =
                  (typeof payload.title === "string" && payload.title) ||
                  a.task?.title ||
                  "(sem título)";
                const fp =
                  typeof payload.functionPoints === "number" ? payload.functionPoints : null;
                const isDone = payload.status === "done";
                const dueDate = typeof payload.dueDate === "string" ? payload.dueDate : null;
                const rejected = a.decision === "rejected";

                return (
                  <div
                    key={a.id}
                    role="button"
                    tabIndex={0}
                    onClick={() => setOpenAction(a)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") setOpenAction(a);
                    }}
                    className={`flex cursor-pointer items-start gap-3 px-3 py-2.5 hover:bg-accent/40 ${rejected ? "opacity-50" : ""}`}
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
                        {fp !== null && <Badge variant="secondary">{fp} PFV</Badge>}
                        {isDone && <Badge variant="outline">concluída</Badge>}
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
                          onClick={(e) => {
                            e.stopPropagation();
                            setDecision(a.id, "pending");
                          }}
                        >
                          <RotateCcw className="size-4" />
                        </Button>
                      ) : (
                        <Button
                          size="icon-sm"
                          variant="ghost"
                          title="Descartar"
                          onClick={(e) => {
                            e.stopPropagation();
                            setDecision(a.id, "rejected");
                          }}
                        >
                          <X className="size-4" />
                        </Button>
                      ))}
                  </div>
                );
              })}
            </section>
          );
        })}
      </div>

      {/* Sheet rico da proposta (aprovar/editar payload) — paridade c/ Sprint Planning */}
      {openAction && planningCeremonyId && (
        <MeetingTaskActionSheet
          open={true}
          onOpenChange={(open) => !open && setOpenAction(null)}
          action={openAction as MeetingTaskAction}
          projectId={projectId}
          decisionUrl={`/api/planning/${planningCeremonyId}/actions/${openAction.id}`}
          onChange={() => {
            setOpenAction(null);
            void loadAll();
          }}
        />
      )}

      {/* Sheet da task real do board (read/edição rica) */}
      <TaskSheetByRef
        taskId={openTaskId}
        onClose={() => setOpenTaskId(null)}
        onAfterChange={loadAll}
      />

      <ConfirmDialog state={confirmState} onClose={() => setConfirmState(null)} />
    </div>
  );
}
