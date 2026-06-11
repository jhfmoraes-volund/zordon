/**
 * Métricas de capacidade & alocação — 7 defs do catálogo §2.3 do runbook.
 *
 * DAL: src/lib/dal/capacity.ts (views `sprint_member_capacity` +
 * `member_commitment_overview`) — importado dinamicamente dentro de `compute`
 * (DAL é server-only; este módulo carrega no doc-gen via tsx).
 *
 * ⚠ Viés conhecido na defense quando existir: capacity reflete alocação
 * corrente — time que mudou no meio carrega viés (congelar por sprint = v2).
 * Honestidade > marketing.
 */
import type { MetricCtx, MetricDef, MetricValue } from "./types";
import { getCachedProjectStats } from "./project-metrics";

function asOfNow(): string {
  return new Date().toISOString();
}

function dal() {
  return import("@/lib/dal/capacity");
}

/** Linhas ativas com cache por request — fan-out de factory.* compartilha o fetch. */
function getCachedActiveLines(ctx: MetricCtx) {
  const key = "factory:active-lines";
  if (!ctx.cache.has(key)) {
    ctx.cache.set(key, dal().then((d) => d.getActiveLines()));
  }
  return ctx.cache.get(key) as Promise<
    Awaited<ReturnType<typeof import("@/lib/dal/capacity").getActiveLines>>
  >;
}

function requireScopeId(id: string, scope: string, scopeId?: string): string {
  if (!scopeId) throw new Error(`Métrica "${id}" tem escopo ${scope} — scopeId é obrigatório.`);
  return scopeId;
}

export const CAPACITY_METRICS: MetricDef[] = [
  {
    id: "member.utilization",
    name: "Aproveitamento do builder",
    question: "quanto da capacidade deste builder vira entrega?",
    unit: "pct",
    scope: "member",
    formulaText: "Σ done ÷ Σ capacity do builder, janela 6 sprints fechadas",
    defense:
      "De cada 100 FP que este builder tinha de capacidade, quantos viraram entrega. ⚠ capacity reflete alocação corrente — time que mudou no meio carrega viés (congelar por sprint = v2).",
    lineage: ["sprint_member_capacity", "Sprint"],
    snapshot: true,
    compute: async (ctx, scopeId): Promise<MetricValue> => {
      const memberId = requireScopeId("member.utilization", "member", scopeId);
      const windows = await (await dal()).getMemberUtilizationWindows([memberId]);
      const w = windows.get(memberId);
      if (!w || w.capacity <= 0) return { value: null, asOf: asOfNow() };
      return {
        value: Math.round((w.done / w.capacity) * 100),
        components: { done: w.done, capacity: w.capacity, sprints: w.samples },
        asOf: asOfNow(),
      };
    },
  },
  {
    id: "member.committed_vs_capacity",
    name: "Compromisso do builder",
    question: "quanto da capacidade do builder já está prometida?",
    unit: "pct",
    scope: "member",
    formulaText: "Σ committed cross-projeto ÷ capacityTotal, sprint corrente",
    defense:
      "Quanto da capacidade do builder já está prometida — acima de 100% é overbooking.",
    lineage: ["member_commitment_overview"],
    snapshot: true,
    compute: async (ctx, scopeId): Promise<MetricValue> => {
      const memberId = requireScopeId("member.committed_vs_capacity", "member", scopeId);
      const c = await (await dal()).getMemberCommitment(memberId);
      if (!c || c.capacity <= 0) return { value: null, asOf: asOfNow() };
      return {
        value: Math.round((c.committed / c.capacity) * 100),
        components: { committed: c.committed, capacity: c.capacity, projects: c.projectCount },
        asOf: asOfNow(),
      };
    },
  },
  {
    id: "squad.utilization",
    name: "Aproveitamento do squad",
    question: "quanto da capacidade do squad vira entrega?",
    unit: "pct",
    scope: "squad",
    formulaText: "Σ done ÷ Σ capacity dos membros do squad, janela 6 sprints fechadas",
    defense:
      "O squad como unidade: capacidade alocada virando entrega. ⚠ capacity reflete alocação corrente — time que mudou no meio carrega viés (congelar por sprint = v2).",
    lineage: ["SquadMember", "sprint_member_capacity", "Sprint"],
    snapshot: true,
    compute: async (ctx, scopeId): Promise<MetricValue> => {
      const squadId = requireScopeId("squad.utilization", "squad", scopeId);
      const d = await dal();
      const memberIds = await d.getSquadMemberIds(squadId);
      if (memberIds.length === 0) return { value: null, asOf: asOfNow() };
      const windows = await d.getMemberUtilizationWindows(memberIds);
      let done = 0;
      let capacity = 0;
      for (const w of windows.values()) {
        done += w.done;
        capacity += w.capacity;
      }
      if (capacity <= 0) return { value: null, asOf: asOfNow() };
      return {
        value: Math.round((done / capacity) * 100),
        components: { done, capacity, members: memberIds.length },
        asOf: asOfNow(),
      };
    },
  },
  {
    id: "factory.utilization",
    name: "Aproveitamento da fábrica",
    question: "quanto da capacidade da fábrica vira entrega?",
    unit: "pct",
    scope: "factory",
    formulaText: "média de project.utilization das linhas ativas",
    defense:
      "A fábrica inteira: média das linhas ativas (já é a 'média da fábrica' do ribbon).",
    lineage: ["Project", "Sprint", "sprint_capacity_overview"],
    snapshot: true,
    compute: async (ctx): Promise<MetricValue> => {
      const lines = await getCachedActiveLines(ctx);
      const utils = (
        await Promise.all(lines.map((l) => getCachedProjectStats(ctx, l.id)))
      )
        .map((s) => s?.utilizationPct ?? null)
        .filter((v): v is number => v !== null);
      if (utils.length === 0) return { value: null, asOf: asOfNow() };
      return {
        value: Math.round(utils.reduce((sum, v) => sum + v, 0) / utils.length),
        components: { lines: lines.length, linesWithData: utils.length },
        asOf: asOfNow(),
      };
    },
  },
  {
    id: "factory.committed_vs_capacity",
    name: "Carga da fábrica",
    question: "a fábrica está ociosa ou superlotada?",
    unit: "pct",
    scope: "factory",
    formulaText: "Σ committed ÷ Σ capacity dos product-builders internos",
    defense:
      "De cada 100 FP de capacidade dos builders, quantos já estão prometidos a projetos. Abaixo de 70 há ociosidade; acima de 100 é superlotação. ⚠ committed soma alocações de todos os projetos com membro alocado, inclusive pausados.",
    lineage: ["member_commitment_overview"],
    thresholds: [
      { label: "superlotação", tone: "red", gte: 101 },
      { label: "saudável", tone: "green", gte: 70 },
      { label: "ociosidade", tone: "amber", gte: null },
    ],
    snapshot: true,
    compute: async (): Promise<MetricValue> => {
      const { committed, capacity, builders } = await (await dal()).getFactoryCommitment();
      if (capacity <= 0) return { value: null, asOf: asOfNow() };
      return {
        value: Math.round((committed / capacity) * 100),
        components: { committed, capacity, builders },
        asOf: asOfNow(),
      };
    },
  },
  {
    id: "factory.commercial_buffer",
    name: "Em comercial",
    question: "quantos projetos estão pra começar?",
    unit: "count",
    scope: "factory",
    formulaText: "projetos ativos em fase commercial (sem internos/eval)",
    defense:
      "Projetos em comercial — o buffer da fábrica: contratos a caminho de virar linha de produção.",
    lineage: ["Project"],
    snapshot: true,
    compute: async (): Promise<MetricValue> => {
      const buffer = await (await dal()).getCommercialBuffer();
      return { value: buffer, asOf: asOfNow() };
    },
  },
  {
    id: "factory.builders_allocated",
    name: "Builders alocados",
    question: "quantos builders estão em linha de produção?",
    unit: "count",
    scope: "factory",
    formulaText: "Members `position='product-builder'` com alocação ativa / total",
    defense: "Quantos builders estão em linha de produção agora.",
    lineage: ["Member", "ProjectMember", "Project"],
    snapshot: true,
    compute: async (): Promise<MetricValue> => {
      const { allocated, total } = await (await dal()).getBuilderAllocation();
      return { value: allocated, components: { allocated, total }, asOf: asOfNow() };
    },
  },
  {
    id: "factory.lines_active",
    name: "Linhas ativas",
    question: "quantas linhas de produção estão rodando?",
    unit: "count",
    scope: "factory",
    formulaText: "projetos em fase produtiva (immersion/ops)",
    defense: "Linhas de produção rodando.",
    lineage: ["Project"],
    snapshot: true,
    compute: async (ctx): Promise<MetricValue> => {
      const lines = await getCachedActiveLines(ctx);
      return { value: lines.length, asOf: asOfNow() };
    },
  },
  {
    id: "factory.clients_active",
    name: "Clientes ativos",
    question: "quantos clientes têm produção ativa?",
    unit: "count",
    scope: "factory",
    formulaText: "distinct clients de linhas ativas (sem internos/eval)",
    defense: "Clientes com produção ativa.",
    lineage: ["Project", "Client"],
    snapshot: true,
    compute: async (ctx): Promise<MetricValue> => {
      const lines = await getCachedActiveLines(ctx);
      const clients = new Set(lines.map((l) => l.clientId).filter(Boolean));
      return {
        value: clients.size,
        components: { lines: lines.length },
        asOf: asOfNow(),
      };
    },
  },
];
