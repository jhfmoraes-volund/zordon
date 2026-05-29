import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { AgentUsageTable } from "@/components/admin/agent-usage-table";

export const dynamic = "force-dynamic";

type UsageRow = {
  id: string;
  agentName: string;
  callKind: string;
  modelId: string;
  costUsd: number;
  promptTokens: number;
  cachedPromptTokens: number | null;
  completionTokens: number;
  latencyMs: number | null;
  threadId: string | null;
  projectId: string | null;
  createdAt: string;
};

type Summary = {
  totalUsd: number;
  totalCalls: number;
  totalInputTokens: number;
  totalCachedTokens: number;
  totalOutputTokens: number;
};

function emptySummary(): Summary {
  return {
    totalUsd: 0,
    totalCalls: 0,
    totalInputTokens: 0,
    totalCachedTokens: 0,
    totalOutputTokens: 0,
  };
}

function accumulate(s: Summary, r: UsageRow): Summary {
  return {
    totalUsd: s.totalUsd + Number(r.costUsd ?? 0),
    totalCalls: s.totalCalls + 1,
    totalInputTokens: s.totalInputTokens + (r.promptTokens ?? 0),
    totalCachedTokens: s.totalCachedTokens + (r.cachedPromptTokens ?? 0),
    totalOutputTokens: s.totalOutputTokens + (r.completionTokens ?? 0),
  };
}

function fmtUsd(n: number): string {
  return `$${n.toFixed(2)}`;
}

function fmtInt(n: number): string {
  return n.toLocaleString("pt-BR");
}

function cacheHitRatio(s: Summary): string {
  if (s.totalInputTokens === 0) return "—";
  return `${Math.round((s.totalCachedTokens / s.totalInputTokens) * 100)}%`;
}

function timeWindowsFromNow(): { since24h: string; since7d: string; since30d: string } {
  const now = Date.now();
  return {
    since24h: new Date(now - 24 * 60 * 60 * 1000).toISOString(),
    since7d: new Date(now - 7 * 24 * 60 * 60 * 1000).toISOString(),
    since30d: new Date(now - 30 * 24 * 60 * 60 * 1000).toISOString(),
  };
}

export default async function AgentUsagePage() {
  const supabase = await createClient();

  const { since24h, since7d, since30d } = timeWindowsFromNow();

  const [rows24h, rows7d, rows30d, recent] = await Promise.all([
    supabase
      .from("AgentUsage")
      .select(
        "id, agentName, callKind, modelId, costUsd, promptTokens, cachedPromptTokens, completionTokens, latencyMs, threadId, projectId, createdAt",
      )
      .gte("createdAt", since24h),
    supabase
      .from("AgentUsage")
      .select("agentName, callKind, costUsd, promptTokens, cachedPromptTokens, completionTokens")
      .gte("createdAt", since7d),
    supabase
      .from("AgentUsage")
      .select("agentName, costUsd, promptTokens, cachedPromptTokens, completionTokens")
      .gte("createdAt", since30d),
    supabase
      .from("AgentUsage")
      .select(
        "id, agentName, callKind, modelId, costUsd, promptTokens, cachedPromptTokens, completionTokens, latencyMs, threadId, projectId, createdAt",
      )
      .order("createdAt", { ascending: false })
      .limit(100),
  ]);

  const s24h = (rows24h.data ?? []).reduce(accumulate, emptySummary());
  const s7d = (rows7d.data ?? []).reduce(
    (s, r) =>
      accumulate(s, {
        ...r,
        id: "",
        modelId: "",
        latencyMs: null,
        threadId: null,
        projectId: null,
        createdAt: "",
      } as UsageRow),
    emptySummary(),
  );
  const s30d = (rows30d.data ?? []).reduce(
    (s, r) =>
      accumulate(s, {
        ...r,
        id: "",
        callKind: "",
        modelId: "",
        latencyMs: null,
        threadId: null,
        projectId: null,
        createdAt: "",
      } as UsageRow),
    emptySummary(),
  );

  // Breakdown por agente nas últimas 24h
  const byAgent = new Map<string, Summary>();
  for (const r of rows24h.data ?? []) {
    const cur = byAgent.get(r.agentName) ?? emptySummary();
    byAgent.set(r.agentName, accumulate(cur, r as UsageRow));
  }
  const agentsSorted = [...byAgent.entries()].sort((a, b) => b[1].totalUsd - a[1].totalUsd);

  // Breakdown por callKind nas últimas 24h
  const byKind = new Map<string, Summary>();
  for (const r of rows24h.data ?? []) {
    const cur = byKind.get(r.callKind) ?? emptySummary();
    byKind.set(r.callKind, accumulate(cur, r as UsageRow));
  }
  const kindsSorted = [...byKind.entries()].sort((a, b) => b[1].totalUsd - a[1].totalUsd);

  // Top sessions por custo (agrupando recentes por threadId)
  const sessionTotals = new Map<string, { calls: number; cost: number; latestAt: string; agentName: string }>();
  for (const r of (recent.data ?? []) as UsageRow[]) {
    if (!r.threadId) continue;
    const cur = sessionTotals.get(r.threadId) ?? {
      calls: 0,
      cost: 0,
      latestAt: r.createdAt,
      agentName: r.agentName,
    };
    cur.calls += 1;
    cur.cost += Number(r.costUsd ?? 0);
    if (r.createdAt > cur.latestAt) cur.latestAt = r.createdAt;
    sessionTotals.set(r.threadId, cur);
  }
  const topSessions = [...sessionTotals.entries()]
    .sort((a, b) => b[1].cost - a[1].cost)
    .slice(0, 10);

  return (
    <div className="mx-auto w-full max-w-7xl space-y-6 px-4 py-6">
      <PageHeader
        title="Custos de agentes"
        description="Tokens consumidos, custo USD e latência por agente, callKind e sessão. Cache hit ratio mede economia via prompt caching."
      />

      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <SummaryCard label="Últimas 24h" s={s24h} />
        <SummaryCard label="Últimos 7 dias" s={s7d} />
        <SummaryCard label="Últimos 30 dias" s={s30d} />
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Por agente (24h)</CardTitle>
          </CardHeader>
          <CardContent className="px-4">
            {agentsSorted.length === 0 ? (
              <p className="text-sm text-muted-foreground">Sem dados nas últimas 24h.</p>
            ) : (
              <ul className="space-y-2">
                {agentsSorted.map(([name, s]) => (
                  <li
                    key={name}
                    className="flex items-center justify-between rounded-md border border-border bg-muted/20 px-3 py-2"
                  >
                    <span className="font-mono text-xs uppercase tracking-wider">
                      {name}
                    </span>
                    <span className="text-sm tabular-nums">
                      {fmtUsd(s.totalUsd)} · {s.totalCalls} calls · cache {cacheHitRatio(s)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Por tipo de chamada (24h)</CardTitle>
          </CardHeader>
          <CardContent className="px-4">
            {kindsSorted.length === 0 ? (
              <p className="text-sm text-muted-foreground">Sem dados nas últimas 24h.</p>
            ) : (
              <ul className="space-y-2">
                {kindsSorted.map(([kind, s]) => (
                  <li
                    key={kind}
                    className="flex items-center justify-between rounded-md border border-border bg-muted/20 px-3 py-2"
                  >
                    <span className="font-mono text-xs uppercase tracking-wider">
                      {kind}
                    </span>
                    <span className="text-sm tabular-nums">
                      {fmtUsd(s.totalUsd)} · {s.totalCalls} calls · in {fmtInt(s.totalInputTokens)} / out {fmtInt(s.totalOutputTokens)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Top 10 sessões por custo (últimas 100 chamadas)</CardTitle>
        </CardHeader>
        <CardContent className="px-4">
          {topSessions.length === 0 ? (
            <p className="text-sm text-muted-foreground">Sem sessões registradas ainda.</p>
          ) : (
            <ul className="space-y-1.5">
              {topSessions.map(([threadId, s]) => (
                <li
                  key={threadId}
                  className="flex items-center justify-between gap-3 rounded-md border border-border bg-muted/20 px-3 py-2 text-sm"
                >
                  <span className="truncate font-mono text-xs text-muted-foreground">
                    thread {threadId.slice(0, 8)}… · {s.agentName}
                  </span>
                  <span className="shrink-0 tabular-nums">
                    {fmtUsd(s.cost)} · {s.calls} calls
                  </span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Últimas 100 chamadas</CardTitle>
        </CardHeader>
        <CardContent className="px-0">
          <AgentUsageTable rows={(recent.data ?? []) as UsageRow[]} />
        </CardContent>
      </Card>
    </div>
  );
}

function SummaryCard({ label, s }: { label: string; s: Summary }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-xs uppercase tracking-wider text-muted-foreground">
          {label}
        </CardTitle>
      </CardHeader>
      <CardContent className="px-4">
        <div className="text-2xl font-semibold tabular-nums">{fmtUsd(s.totalUsd)}</div>
        <div className="mt-1 text-xs text-muted-foreground tabular-nums">
          {s.totalCalls} chamadas · cache {cacheHitRatio(s)}
        </div>
        <div className="mt-2 text-xs text-muted-foreground tabular-nums">
          in {fmtInt(s.totalInputTokens)} (cached {fmtInt(s.totalCachedTokens)}) / out {fmtInt(s.totalOutputTokens)}
        </div>
      </CardContent>
    </Card>
  );
}
