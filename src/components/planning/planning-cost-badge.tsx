"use client";

import { useEffect, useState } from "react";
import { Coins } from "lucide-react";
import { useAuth } from "@/contexts/auth-context";
import { hasMinAccessLevel } from "@/lib/roles";

type UsageSummary = {
  totalCost: number;
  totalCalls: number;
  cacheHitRatio: number | null;
};

/**
 * Mostra custo + # de chamadas da sessão (thread) do agente atual.
 * Visível só pra manager+. Refetch leve a cada 30s pra captar novas calls
 * que rolarem durante o planning.
 */
export function PlanningCostBadge({ threadId }: { threadId: string | null }) {
  const { effectiveAccessLevel } = useAuth();
  const canSee = hasMinAccessLevel(effectiveAccessLevel, "manager");

  const [summary, setSummary] = useState<UsageSummary | null>(null);

  useEffect(() => {
    if (!threadId || !canSee) return;

    let active = true;
    const fetchSummary = async () => {
      try {
        const r = await fetch(`/api/agent-usage/by-thread/${threadId}`);
        if (!r.ok) return;
        const data = (await r.json()) as UsageSummary;
        if (active) setSummary(data);
      } catch {
        // silencia — telemetria nunca quebra a UI
      }
    };

    fetchSummary();
    const id = setInterval(fetchSummary, 30_000);
    return () => {
      active = false;
      clearInterval(id);
    };
  }, [threadId, canSee]);

  if (!canSee || !threadId || !summary || summary.totalCalls === 0) return null;

  const cacheLabel =
    summary.cacheHitRatio != null
      ? ` · cache ${Math.round(summary.cacheHitRatio * 100)}%`
      : "";

  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-md border border-border bg-muted/40 px-2 py-1 text-xs font-mono text-muted-foreground tabular-nums"
      title={`Custo total da sessão (${summary.totalCalls} chamadas)${cacheLabel}`}
    >
      <Coins className="h-3 w-3" />
      ${summary.totalCost.toFixed(2)} · {summary.totalCalls} calls
    </span>
  );
}
