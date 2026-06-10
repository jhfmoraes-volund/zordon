/**
 * Metrics registry — contratos (§2.2 do runbook, literais).
 *
 * Runbook: docs/runbooks/metrics-registry-runbook.md
 * Regra de ouro: métrica só existe se está no registry; nenhuma mudança de
 * fórmula sem atualizar `defense` junto.
 *
 * Imports só de tipo — este módulo precisa carregar fora do Next (doc-gen via
 * tsx); nada de runtime aqui.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";

export type MetricScope = "project" | "member" | "squad" | "factory";

export type Threshold = {
  label: string;                  // "à frente" | "no ritmo" | "atrás" | "crítico"
  tone: "green" | "amber" | "red" | "critical";
  /** valor mínimo (inclusive) pra cair nesta faixa; faixas em ordem decrescente */
  gte: number | null;
};

export type MetricValue = {
  value: number | null;           // null = não computável (ex.: projeto sem FP)
  components?: Record<string, number>; // numerador/denominador — auditável
  asOf: string;                   // ISO date
};

/**
 * Contexto de uma computação — client supabase (admin no cron, user-scoped na
 * UI/Alpha) + cache por request: 1 fetch de stats por projeto, N fatias
 * (nunca recomputar computeStats 10× pra 10 métricas do mesmo projeto).
 * O cache guarda Promises — chamadas concorrentes compartilham o fetch.
 */
export type MetricCtx = {
  supabase: SupabaseClient<Database>;
  cache: Map<string, unknown>;
};

export type MetricDef = {
  id: string;                     // "project.pace_gap" — namespace = scope
  name: string;                   // "Pace"
  question: string;               // "estamos no ritmo do contrato?"
  unit: "pp" | "fp" | "pct" | "sprints" | "count" | "fp_per_sprint";
  scope: MetricScope;
  formulaText: string;            // "scopePct − timePct" — exibível
  defense: string;                // frase pro CEO — tooltip da UI E resposta do Alpha
  lineage: string[];              // tabelas/views fonte
  thresholds?: Threshold[];
  snapshot: boolean;              // entra no cron semanal?
  compute: (ctx: MetricCtx, scopeId?: string) => Promise<MetricValue>;
};
