/**
 * ALERT_REGISTRY — alertas operacionais da aba Operação (D11).
 *
 * Irmão do METRIC_REGISTRY com a mesma anatomia e disciplina: alerta só
 * existe se está aqui; nenhuma mudança de regra sem atualizar `defense`
 * junto. Alerta ≠ métrica — o catálogo de 20 métricas (D2) fica intacto.
 * O markdown `docs/features/overview/stats-dictionary.md` lista os alertas
 * a partir deste módulo (gerado, nunca editado à mão).
 *
 * DAL importado dinamicamente dentro de `compute` (server-only; este módulo
 * carrega no doc-gen via tsx). Recortes de gente seguem D10: headcount crava
 * em `Member.position`, nunca em elegibilidade.
 */
import type { MetricCtx } from "./types";
import { fmtDate } from "@/lib/date-utils";

export type AlertSeverity = "critical" | "warning" | "info";

export type AlertValue = {
  /** total real de ocorrências — 0 = alerta silencioso */
  count: number;
  /** amostra exibível pro detail da UI (count é sempre o total) */
  items: string[];
  asOf: string; // ISO date
};

export type AlertDef = {
  id: string;            // "alert.tasks_overdue" — namespace fixo "alert"
  name: string;          // "Tasks com prazo vencido"
  question: string;      // "o que já furou o combinado?"
  severity: AlertSeverity;
  ruleText: string;      // regra exibível — espelha formulaText do MetricDef
  defense: string;       // frase pro CEO — tooltip da UI E resposta do Alpha
  lineage: string[];     // tabelas/views/RPCs fonte
  compute: (ctx: MetricCtx) => Promise<AlertValue>;
};

/** Dias sem update pra task in_progress contar como parada (regra, não leitura). */
export const STUCK_DAYS = 3;

function asOfNow(): string {
  return new Date().toISOString();
}

function dal() {
  return import("@/lib/dal/ops-alerts");
}

/** Builder commitments com cache por request — overbooked/idle compartilham o fetch. */
function getCachedBuilderCommitments(ctx: MetricCtx) {
  const key = "factory:builder-commitments";
  if (!ctx.cache.has(key)) {
    ctx.cache.set(
      key,
      import("@/lib/dal/capacity").then((d) => d.getBuilderCommitments()),
    );
  }
  return ctx.cache.get(key) as Promise<
    Awaited<ReturnType<typeof import("@/lib/dal/capacity").getBuilderCommitments>>
  >;
}

export const ALERT_REGISTRY: AlertDef[] = [
  {
    id: "alert.tasks_overdue",
    name: "Tasks com prazo vencido",
    question: "o que já furou o combinado?",
    severity: "critical",
    ruleText: "dueDate < hoje, status fora de done/draft, sem dismiss",
    defense:
      "O prazo combinado passou e a task segue aberta — ou o prazo era irreal ou a entrega travou; os dois pedem ação hoje.",
    lineage: ["Task", "Project", "TaskAssignment"],
    compute: async (): Promise<AlertValue> => {
      const { count, items } = await (await dal()).getOverdueTasks();
      return {
        count,
        items: items.map(
          (t) => `${t.reference} — ${t.projectName ?? "?"} (${fmtDate(t.dueDate)})`,
        ),
        asOf: asOfNow(),
      };
    },
  },
  {
    id: "alert.tasks_unassigned",
    name: "Tasks sem responsável em sprint ativa",
    question: "o que está em sprint ativa sem dono?",
    severity: "warning",
    ruleText: "tasks abertas em sprint ativa sem TaskAssignment (RPC)",
    defense:
      "Task em sprint ativa sem dono não anda sozinha — alguém puxa ou ela vira buraco na sprint.",
    lineage: ["unassigned_active_task_count", "Task", "Sprint", "TaskAssignment"],
    compute: async (): Promise<AlertValue> => {
      const count = await (await dal()).getUnassignedActiveCount();
      return { count, items: [], asOf: asOfNow() };
    },
  },
  {
    id: "alert.tasks_stuck",
    name: "Tasks paradas",
    question: "o que está em andamento mas não anda?",
    severity: "warning",
    ruleText: `in_progress sem update há ${STUCK_DAYS}+ dias, sem dismiss`,
    defense: `Task em andamento sem movimento há ${STUCK_DAYS}+ dias costuma ser bloqueio não-dito — melhor perguntar do que esperar.`,
    lineage: ["Task", "Project", "TaskAssignment"],
    compute: async (): Promise<AlertValue> => {
      const { count, items } = await (await dal()).getStuckTasks(STUCK_DAYS);
      return {
        count,
        items: items.map((t) => `${t.reference} (${t.assigneeName ?? "sem responsável"})`),
        asOf: asOfNow(),
      };
    },
  },
  {
    id: "alert.builders_overbooked",
    name: "Builders em overbooking",
    question: "quem prometeu mais do que cabe?",
    severity: "warning",
    ruleText: "committed > capacity, product-builders (member_commitment_overview)",
    defense:
      "Mesma régua do member.committed_vs_capacity: acima de 100% é overbooking. Substituiu o threshold local de 85% da aba (D11) — uma régua só, na UI e na boca do Alpha.",
    lineage: ["member_commitment_overview"],
    compute: async (ctx): Promise<AlertValue> => {
      const builders = await getCachedBuilderCommitments(ctx);
      const over = builders.filter((b) => b.capacity > 0 && b.committed > b.capacity);
      return {
        count: over.length,
        items: over.map(
          (b) => `${b.name} (${Math.round((b.committed / b.capacity) * 100)}%)`,
        ),
        asOf: asOfNow(),
      };
    },
  },
  {
    id: "alert.builders_idle",
    name: "Builders sem alocação",
    question: "quem está com capacidade ociosa?",
    severity: "info",
    ruleText: "committed = 0 com capacity > 0, product-builders (member_commitment_overview)",
    defense:
      "Builder com capacidade e zero PFV prometida em qualquer projeto — ociosidade visível, não acusação. Substituiu o threshold local de 10% da aba (D11).",
    lineage: ["member_commitment_overview"],
    compute: async (ctx): Promise<AlertValue> => {
      const builders = await getCachedBuilderCommitments(ctx);
      const idle = builders.filter((b) => b.capacity > 0 && b.committed === 0);
      return {
        count: idle.length,
        items: idle.map((b) => b.name),
        asOf: asOfNow(),
      };
    },
  },
];

const byId = new Map(ALERT_REGISTRY.map((def) => [def.id, def]));

export function getAlertDef(id: string): AlertDef | null {
  return byId.get(id) ?? null;
}

export function listAlertDefs(): AlertDef[] {
  return ALERT_REGISTRY;
}

const SEVERITY_ORDER: Record<AlertSeverity, number> = { critical: 0, warning: 1, info: 2 };

/**
 * Computa todos os alertas, ordenados por severidade. O ctx compartilha
 * cache por request entre defs (1 fetch de commitments pra 2 alertas).
 */
export async function computeAlerts(
  ctx: MetricCtx,
): Promise<Array<{ def: AlertDef; value: AlertValue }>> {
  const results = await Promise.all(
    ALERT_REGISTRY.map(async (def) => ({ def, value: await def.compute(ctx) })),
  );
  return results.sort((a, b) => SEVERITY_ORDER[a.def.severity] - SEVERITY_ORDER[b.def.severity]);
}
