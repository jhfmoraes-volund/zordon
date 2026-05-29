import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

type RouteParams = { params: Promise<{ threadId: string }> };

/**
 * Agregado por thread: cost total + breakdown por callKind.
 * Usado pelo PlanningCostBadge no PlanningRibbon. Acesso gated por RLS
 * (manager+ ou member com ProjectAccess do projectId associado).
 */
export async function GET(_req: Request, { params }: RouteParams) {
  const { threadId } = await params;
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("AgentUsage")
    .select("callKind, costUsd, promptTokens, cachedPromptTokens, completionTokens, latencyMs")
    .eq("threadId", threadId);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  let totalCost = 0;
  let totalCalls = 0;
  let totalInput = 0;
  let totalCached = 0;
  let totalOutput = 0;
  const byKind = new Map<string, { calls: number; cost: number }>();

  for (const r of data ?? []) {
    totalCost += Number(r.costUsd ?? 0);
    totalCalls += 1;
    totalInput += r.promptTokens ?? 0;
    totalCached += r.cachedPromptTokens ?? 0;
    totalOutput += r.completionTokens ?? 0;
    const cur = byKind.get(r.callKind) ?? { calls: 0, cost: 0 };
    cur.calls += 1;
    cur.cost += Number(r.costUsd ?? 0);
    byKind.set(r.callKind, cur);
  }

  return NextResponse.json({
    threadId,
    totalCost,
    totalCalls,
    totalInputTokens: totalInput,
    totalCachedTokens: totalCached,
    totalOutputTokens: totalOutput,
    cacheHitRatio: totalInput > 0 ? totalCached / totalInput : null,
    byKind: [...byKind.entries()].map(([kind, v]) => ({ kind, ...v })),
  });
}
