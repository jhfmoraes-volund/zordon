/**
 * computeMetric — entrada única pra computar qualquer métrica do registry.
 *
 * Todo número de operação (UI, Alpha, cron) nasce aqui (D9: proibido
 * aritmética de cabeça). O ctx carrega cache por request — computar as 11
 * métricas de um projeto custa 1 fetch de stats, não 11.
 */
import { db } from "@/lib/db";
import type { MetricCtx, MetricValue } from "./types";
import { getMetricDef, listMetricDefs } from "./registry";

export function createMetricCtx(supabase: MetricCtx["supabase"] = db()): MetricCtx {
  return { supabase, cache: new Map() };
}

export async function computeMetric(
  ctx: MetricCtx,
  id: string,
  scopeId?: string,
): Promise<MetricValue> {
  const def = getMetricDef(id);
  if (!def) {
    const known = listMetricDefs()
      .map((d) => d.id)
      .join(", ");
    throw new Error(`Métrica desconhecida: "${id}". Catálogo: ${known}`);
  }
  if (def.scope !== "factory" && !scopeId) {
    throw new Error(`Métrica "${id}" tem escopo ${def.scope} — scopeId é obrigatório.`);
  }
  return def.compute(ctx, scopeId);
}
