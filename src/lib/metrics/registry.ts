/**
 * METRIC_REGISTRY — o dicionário vivo (D1: SSOT em código).
 *
 * Catálogo v1 = exatamente 18 métricas (§2.3 do runbook): 11 de
 * projeto/contrato + 7 de capacidade & alocação. Não adicionar métrica fora
 * do catálogo sem nova decisão (D2).
 *
 * O markdown `docs/features/overview/stats-dictionary.md` é GERADO daqui
 * (scripts/gen-metrics-doc.ts) — nunca editado à mão.
 */
import type { MetricDef, MetricScope } from "./types";
import { PROJECT_METRICS } from "./project-metrics";
import { CAPACITY_METRICS } from "./capacity-metrics";

export const METRIC_REGISTRY: MetricDef[] = [...PROJECT_METRICS, ...CAPACITY_METRICS];

const byId = new Map(METRIC_REGISTRY.map((def) => [def.id, def]));

export function getMetricDef(id: string): MetricDef | null {
  return byId.get(id) ?? null;
}

export function listMetricDefs(scope?: MetricScope): MetricDef[] {
  return scope ? METRIC_REGISTRY.filter((def) => def.scope === scope) : METRIC_REGISTRY;
}
