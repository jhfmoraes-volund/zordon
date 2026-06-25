"use client";

import { useCallback, useMemo, useState } from "react";
import { ChevronDown, ClipboardList, Layers, RotateCcw, X } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { MeetingTaskActionSheet } from "@/components/meetings/meeting-task-action-sheet";
import type { MeetingTaskAction } from "@/components/meetings/meeting-task-action-sheet";
import {
  describeEntityProposal,
  type PlanningAction,
} from "@/components/planning/proposal-card";
import type { ProposalRow } from "./use-planning-canvas-data";
import { formatSprintWeek, TypeBadge } from "./planning-proposal-helpers";

const NONE_KEY = "__none__";

type SprintMeta = { id: string; name: string; startDate: string; endDate: string };

type Props = {
  taskProposals: ProposalRow[];
  storyProposals: PlanningAction[];
  moduleProposals: PlanningAction[];
  /** Sprints do projeto — preenchem nome/semana das subseções de Tasks. */
  sprints: SprintMeta[];
  planningCeremonyId: string | null;
  projectId: string;
  readOnly?: boolean;
  /** Descarta/restaura (otimista) — vem do hook. */
  onDecision: (id: string, decision: "pending" | "rejected") => void;
  /** Recarrega o canvas após editar/aprovar uma proposta no sheet. */
  onReload: () => void;
};

function taskTitle(a: ProposalRow): string {
  const p = a.payload ?? {};
  return (
    (typeof p.title === "string" && p.title) || a.task?.title || "(sem título)"
  );
}

/**
 * Lente "Propostas" do canvas — TODAS as mudanças propostas pela Vitoria num só
 * lugar (o "diff" do plano), separadas do que já está aplicado. Agrupado por
 * ENTIDADE: Tasks (subdivididas por sprint, colapsável), User Stories e Módulos
 * (flat — não cabem em sprint). Cor por intenção (criar/atualizar/remover/mover).
 * "Aplicar" (na toolbar da página) comita o lote inteiro.
 */
export function ReleasePlanningProposalsTab({
  taskProposals,
  storyProposals,
  moduleProposals,
  sprints,
  planningCeremonyId,
  projectId,
  readOnly = false,
  onDecision,
  onReload,
}: Props) {
  const [openAction, setOpenAction] = useState<ProposalRow | null>(null);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  const toggleCollapse = useCallback((key: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  const sprintMeta = useMemo(
    () => new Map(sprints.map((s) => [s.id, s])),
    [sprints],
  );

  // Tasks subdivididas por sprint-destino.
  const taskBySprint = useMemo(() => {
    const map = new Map<string, { meta: SprintMeta | null; rows: ProposalRow[] }>();
    for (const a of taskProposals) {
      const id = a.targetSprint?.id ?? a.targetSprintId ?? null;
      const key = id ?? NONE_KEY;
      let g = map.get(key);
      if (!g) {
        g = { meta: id ? sprintMeta.get(id) ?? null : null, rows: [] };
        map.set(key, g);
      }
      g.rows.push(a);
    }
    return Array.from(map.entries()).sort(([ka, ga], [kb, gb]) => {
      if (ka === NONE_KEY) return 1;
      if (kb === NONE_KEY) return -1;
      return (ga.meta?.name ?? "").localeCompare(gb.meta?.name ?? "", undefined, {
        numeric: true,
      });
    });
  }, [taskProposals, sprintMeta]);

  // Resumo (só não-rejeitadas) por intenção.
  const summary = useMemo(() => {
    const all = [...taskProposals, ...storyProposals, ...moduleProposals].filter(
      (a) => a.decision !== "rejected",
    );
    const by = { create: 0, update: 0, delete: 0, move: 0, review: 0 } as Record<
      string,
      number
    >;
    for (const a of all) by[a.type] = (by[a.type] ?? 0) + 1;
    return { total: all.length, by };
  }, [taskProposals, storyProposals, moduleProposals]);

  const isEmpty =
    taskProposals.length === 0 &&
    storyProposals.length === 0 &&
    moduleProposals.length === 0;
  if (isEmpty) return null;

  // ── Linha de proposta (reusada em Tasks / Stories / Módulos) ──────────────
  const renderRow = (
    a: ProposalRow,
    opts: { title: string; meta?: React.ReactNode; onOpen?: () => void },
  ) => {
    const rejected = a.decision === "rejected";
    return (
      <div
        key={a.id}
        role={opts.onOpen ? "button" : undefined}
        tabIndex={opts.onOpen ? 0 : undefined}
        onClick={opts.onOpen}
        onKeyDown={(e) => {
          if (opts.onOpen && (e.key === "Enter" || e.key === " ")) opts.onOpen();
        }}
        className={`flex items-start gap-2.5 px-3 py-2.5 ${opts.onOpen ? "cursor-pointer hover:bg-accent/40" : ""} ${rejected ? "opacity-50" : ""}`}
      >
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <TypeBadge type={a.type} />
            <span
              className={`truncate text-sm font-medium ${rejected ? "line-through" : ""}`}
            >
              {opts.title}
            </span>
          </div>
          {opts.meta}
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
                onDecision(a.id, "pending");
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
                onDecision(a.id, "rejected");
              }}
            >
              <X className="size-4" />
            </Button>
          ))}
      </div>
    );
  };

  const sectionHeader = (
    icon: React.ReactNode,
    label: string,
    count: number,
  ) => (
    <div className="flex items-center gap-2 border-b bg-muted px-3 py-2">
      {icon}
      <span className="text-xs font-semibold uppercase tracking-wide text-foreground">
        {label}
      </span>
      <span className="ml-auto font-mono text-xs text-muted-foreground">
        {count}
      </span>
    </div>
  );

  return (
    <div>
      {/* Resumo do diff — quantas mudanças e de que intenção. */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 border-b bg-background px-3 py-2.5 text-xs">
        <span className="font-medium">
          {summary.total} mudança{summary.total === 1 ? "" : "s"} proposta
          {summary.total === 1 ? "" : "s"}
        </span>
        {summary.by.create > 0 && (
          <span className="flex items-center gap-1.5 text-muted-foreground">
            <span className="size-2 rounded-full bg-emerald-500" />
            {summary.by.create} criar
          </span>
        )}
        {summary.by.update > 0 && (
          <span className="flex items-center gap-1.5 text-muted-foreground">
            <span className="size-2 rounded-full bg-amber-500" />
            {summary.by.update} atualizar
          </span>
        )}
        {summary.by.delete > 0 && (
          <span className="flex items-center gap-1.5 text-muted-foreground">
            <span className="size-2 rounded-full bg-red-500" />
            {summary.by.delete} remover
          </span>
        )}
        {summary.by.move > 0 && (
          <span className="flex items-center gap-1.5 text-muted-foreground">
            <span className="size-2 rounded-full bg-blue-500" />
            {summary.by.move} mover
          </span>
        )}
      </div>

      {/* ── Tasks (subdivididas por sprint) ─────────────────────────────── */}
      {taskProposals.length > 0 && (
        <section className="border-t">
          {sectionHeader(
            <ClipboardList className="size-3.5 text-muted-foreground" />,
            "Tasks",
            taskProposals.filter((a) => a.decision !== "rejected").length,
          )}
          {taskBySprint.map(([key, g]) => {
            const isCollapsed = collapsed.has(key);
            const week = g.meta
              ? formatSprintWeek(g.meta.startDate, g.meta.endDate)
              : null;
            const propCount = g.rows.filter((a) => a.decision !== "rejected").length;
            return (
              <div key={key}>
                <button
                  type="button"
                  onClick={() => toggleCollapse(key)}
                  aria-expanded={!isCollapsed}
                  className="flex w-full items-center gap-2 border-b bg-muted/50 px-3 py-1.5 pl-6 text-left hover:bg-muted/70"
                >
                  <ChevronDown
                    className={`size-3.5 shrink-0 text-muted-foreground transition-transform ${isCollapsed ? "-rotate-90" : ""}`}
                  />
                  <span className="text-xs font-medium text-foreground">
                    {g.meta?.name ?? "Sem sprint"}
                  </span>
                  {week && (
                    <Badge variant="outline" className="font-normal">
                      {week}
                    </Badge>
                  )}
                  <span className="ml-auto font-mono text-xs text-muted-foreground">
                    {propCount}
                  </span>
                </button>
                {!isCollapsed &&
                  g.rows.map((a) => {
                    const fp =
                      typeof a.payload?.functionPoints === "number"
                        ? a.payload.functionPoints
                        : null;
                    return renderRow(a, {
                      title: taskTitle(a),
                      onOpen: () => setOpenAction(a),
                      meta:
                        fp !== null ? (
                          <div className="mt-1">
                            <Badge variant="secondary">{fp} PFV</Badge>
                          </div>
                        ) : undefined,
                    });
                  })}
              </div>
            );
          })}
        </section>
      )}

      {/* ── User Stories (flat) ─────────────────────────────────────────── */}
      {storyProposals.length > 0 && (
        <section className="border-t">
          {sectionHeader(
            <Layers className="size-3.5 text-muted-foreground" />,
            "User Stories",
            storyProposals.filter((a) => a.decision !== "rejected").length,
          )}
          {storyProposals.map((a) =>
            renderRow(a as ProposalRow, { title: describeEntityProposal(a) }),
          )}
        </section>
      )}

      {/* ── Módulos (flat) ──────────────────────────────────────────────── */}
      {moduleProposals.length > 0 && (
        <section className="border-t">
          {sectionHeader(
            <Layers className="size-3.5 text-muted-foreground" />,
            "Módulos",
            moduleProposals.filter((a) => a.decision !== "rejected").length,
          )}
          {moduleProposals.map((a) =>
            renderRow(a as ProposalRow, { title: describeEntityProposal(a) }),
          )}
        </section>
      )}

      {/* Sheet rico da proposta de TASK (aprovar/editar payload) */}
      {openAction && planningCeremonyId && (
        <MeetingTaskActionSheet
          open={true}
          onOpenChange={(open) => !open && setOpenAction(null)}
          action={openAction as MeetingTaskAction}
          projectId={projectId}
          decisionUrl={`/api/planning/${planningCeremonyId}/actions/${openAction.id}`}
          onChange={() => {
            setOpenAction(null);
            onReload();
          }}
        />
      )}
    </div>
  );
}
