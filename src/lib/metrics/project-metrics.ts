/**
 * Métricas de projeto/contrato — 11 defs do catálogo §2.3 do runbook.
 *
 * Regra de ouro: `computeStats()` (src/lib/dal/project-overview.ts) não é
 * reescrito nem movido. Cada def chama `getProjectStats(projectId)` (wrapper
 * público do pipeline) e extrai o campo — se uma fórmula mudar, muda no DAL e
 * registry/UI/Alpha herdam juntos.
 *
 * O DAL é importado dinamicamente dentro de `compute`: este módulo precisa
 * carregar fora do Next (doc-gen via tsx) e o DAL é `server-only`.
 */
import type { MetricCtx, MetricDef, MetricValue } from "./types";
import type { ProjectStats } from "@/lib/dal/project-overview";

/**
 * Stats com cache por request — 1 fetch por projeto, N fatias. Cacheia a
 * Promise: computações concorrentes do mesmo projeto compartilham o fetch.
 */
export function getCachedProjectStats(
  ctx: MetricCtx,
  projectId: string,
): Promise<ProjectStats | null> {
  const key = `project-stats:${projectId}`;
  if (!ctx.cache.has(key)) {
    ctx.cache.set(
      key,
      import("@/lib/dal/project-overview").then((dal) => dal.getProjectStats(projectId)),
    );
  }
  return ctx.cache.get(key) as Promise<ProjectStats | null>;
}

type Slice = { value: number | null; components?: Record<string, number> };

function projectDef(
  def: Omit<MetricDef, "scope" | "compute">,
  pick: (stats: ProjectStats) => Slice,
): MetricDef {
  return {
    ...def,
    scope: "project",
    compute: async (ctx, scopeId): Promise<MetricValue> => {
      if (!scopeId) throw new Error(`Métrica "${def.id}" tem escopo project — scopeId é obrigatório.`);
      const stats = await getCachedProjectStats(ctx, scopeId);
      if (!stats) throw new Error(`Projeto "${scopeId}" não encontrado.`);
      const { value, components } = pick(stats);
      return { value, components, asOf: new Date().toISOString() };
    },
  };
}

export const PROJECT_METRICS: MetricDef[] = [
  projectDef(
    {
      id: "project.sprints_total",
      name: "Sprints do contrato",
      question: "quantas sprints o contrato comprou?",
      unit: "sprints",
      formulaText: "segundas entre mondayOf(startDate) e mondayOf(endDate), inclusivo",
      defense:
        "O contrato é de N sprints — sprint é semana fechada seg→dom, constraint no banco. Contrato de N semanas *é* contrato de N sprints.",
      lineage: ["Project"],
      snapshot: false,
    },
    (s) => ({ value: s.weeksTotal }),
  ),
  projectDef(
    {
      id: "project.sprints_elapsed",
      name: "Sprints decorridas",
      question: "quanto do contrato já queimou em sprints?",
      unit: "sprints",
      formulaText: "segundas decorridas, clamp [0, total]",
      defense: "O calendário queima sozinho — o contrato não espera ninguém apertar play.",
      lineage: ["Project"],
      snapshot: false,
    },
    (s) => ({
      value: s.weeksElapsed,
      components:
        s.weeksElapsed !== null && s.weeksTotal !== null
          ? { elapsed: s.weeksElapsed, total: s.weeksTotal }
          : undefined,
    }),
  ),
  projectDef(
    {
      id: "project.time_pct",
      name: "% do contrato consumido",
      question: "quanto do tempo comprado já passou?",
      unit: "pct",
      formulaText: "elapsed ÷ total",
      defense: "X% do tempo comprado já passou.",
      lineage: ["Project"],
      snapshot: true,
    },
    (s) => ({
      value: s.timePct,
      components:
        s.weeksElapsed !== null && s.weeksTotal !== null
          ? { elapsed: s.weeksElapsed, total: s.weeksTotal }
          : undefined,
    }),
  ),
  projectDef(
    {
      id: "project.sprints_closed",
      name: "Sprints fechadas",
      question: "quantas sprints foram executadas até o fim?",
      unit: "count",
      formulaText: "sprints `completed` OU endDate < hoje",
      defense: "De N sprints compradas, X foram executadas até o fim.",
      lineage: ["Project", "Sprint"],
      snapshot: true,
    },
    (s) => ({ value: s.sprintsClosed }),
  ),
  projectDef(
    {
      id: "project.done_pct",
      name: "Avanço por sprint",
      question: "quanto do contrato virou sprint executada?",
      unit: "pct",
      formulaText: "closed ÷ total",
      defense:
        "Avanço guiado por sprint — o dado universal da fábrica (FP existe em ~1/3 dos projetos).",
      lineage: ["Project", "Sprint"],
      snapshot: true,
    },
    (s) => ({
      value: s.donePct,
      components:
        s.donePct !== null && s.weeksTotal !== null
          ? { closed: s.sprintsClosed, total: s.weeksTotal }
          : undefined,
    }),
  ),
  projectDef(
    {
      id: "project.holes",
      name: "Buracos",
      question: "quantas sprints do contrato queimaram sem produção?",
      unit: "count",
      formulaText: "semanas decorridas sem sprint cobrindo a segunda",
      defense:
        "Sprint do contrato queimada sem produção formalizada. Não acusa ninguém — mostra o fato.",
      lineage: ["Project", "Sprint"],
      snapshot: true,
    },
    (s) => ({ value: s.holes }),
  ),
  projectDef(
    {
      id: "project.scope_pct",
      name: "% do escopo",
      question: "quanto do escopo de hoje está entregue?",
      unit: "pct",
      formulaText: "Σ FP done ÷ Σ FP de tasks vivas",
      defense:
        "Contra o escopo de hoje — cliente adicionou escopo, % cai, e é honesto que caia.",
      lineage: ["Task"],
      snapshot: true,
    },
    (s) => ({
      value: s.scopePct,
      components: s.fpTotal > 0 ? { fpDone: s.fpDone, fpTotal: s.fpTotal } : undefined,
    }),
  ),
  projectDef(
    {
      id: "project.avg_fp_per_sprint",
      name: "Média FP/sprint",
      question: "qual o ritmo real recente da linha?",
      unit: "fp_per_sprint",
      formulaText: "Σ done ÷ n, últimas 6 fechadas com planned > 0",
      defense: "Ritmo real recente da linha — o time como está agora.",
      lineage: ["Sprint", "sprint_capacity_overview"],
      snapshot: true,
    },
    (s) => ({ value: s.avgFpPerSprint }),
  ),
  projectDef(
    {
      id: "project.utilization",
      name: "Aproveitamento",
      question: "quanto da capacidade alocada vira entrega?",
      unit: "pct",
      formulaText: "Σ done ÷ Σ capacity, mesma janela",
      defense: "De cada 100 FP de capacidade alocada, quantos viraram entrega.",
      lineage: ["Sprint", "sprint_capacity_overview"],
      snapshot: true,
    },
    (s) => ({ value: s.utilizationPct }),
  ),
  projectDef(
    {
      id: "project.pace_gap",
      name: "Pace",
      question: "estamos no ritmo do contrato?",
      unit: "pp",
      formulaText: "scopePct − timePct",
      defense:
        "Queimei X% do tempo e entreguei Y% do escopo: Zpp de gap. Uma subtração, zero opinião.",
      lineage: ["Project", "Task"],
      thresholds: [
        { label: "à frente", tone: "green", gte: 5 },
        { label: "no ritmo", tone: "green", gte: -5 },
        { label: "atrás", tone: "amber", gte: -15 },
        { label: "crítico", tone: "red", gte: null },
      ],
      snapshot: true,
    },
    (s) => ({
      value: s.paceGapPp,
      components:
        s.scopePct !== null && s.timePct !== null
          ? { scopePct: s.scopePct, timePct: s.timePct }
          : undefined,
    }),
  ),
  projectDef(
    {
      id: "project.projected_end_sprint",
      name: "Projeção de término",
      question: "no ritmo atual, em que sprint o escopo termina?",
      unit: "sprints",
      formulaText: "elapsed + ceil((fpTotal − fpDone) ÷ avgFp)",
      defense:
        "No ritmo médio recente, a matemática termina na sprint X. Não é palpite: é divisão.",
      lineage: ["Project", "Task", "sprint_capacity_overview"],
      snapshot: true,
    },
    (s) => ({
      value: s.projectedEndWeek,
      components:
        s.projectedEndWeek !== null && s.weeksElapsed !== null && s.avgFpPerSprint !== null
          ? {
              elapsed: s.weeksElapsed,
              fpRemaining: Math.max(0, s.fpTotal - s.fpDone),
              avgFpPerSprint: s.avgFpPerSprint,
            }
          : undefined,
    }),
  ),
];
