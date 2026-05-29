import "server-only";
import { createClient } from "@/lib/supabase/server";
import { estimateCacheSavingsUsd, modelFamily } from "@/lib/agent/pricing";

export type Window = "24h" | "7d" | "30d";

export type WindowSpec = {
  key: Window;
  label: string;
  ms: number;
  bucket: "hour" | "day";
  buckets: number;
};

export const WINDOWS: Record<Window, WindowSpec> = {
  "24h": { key: "24h", label: "Últimas 24h", ms: 24 * 60 * 60 * 1000,        bucket: "hour", buckets: 24 },
  "7d":  { key: "7d",  label: "Últimos 7 dias", ms: 7 * 24 * 60 * 60 * 1000,  bucket: "day",  buckets: 7 },
  "30d": { key: "30d", label: "Últimos 30 dias", ms: 30 * 24 * 60 * 60 * 1000, bucket: "day", buckets: 30 },
};

export type Totals = {
  costUsd: number;
  calls: number;
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  reasoningTokens: number;
};

export type BreakdownRow = {
  key: string;             // model id, agent name, project id, etc.
  label: string;           // human label
  costUsd: number;
  calls: number;
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  reasoningTokens: number;
  cacheSavedUsd: number;
};

export type SeriesPoint = {
  bucket: string;          // ISO timestamp of bucket start
  costUsd: number;
  calls: number;
};

export type StackedSeriesPoint = {
  bucket: string;
  [key: string]: string | number;
};

export type StackDim = "agent" | "model" | "callKind";

export type StackedSeries = {
  keys: string[];
  data: StackedSeriesPoint[];
};

export type TopSession = {
  threadId: string;
  agentName: string;
  costUsd: number;
  calls: number;
  latestAt: string;
  avgLatencyMs: number | null;
};

export type TopCall = {
  id: string;
  agentName: string;
  modelId: string;
  callKind: string;
  costUsd: number;
  inputTokens: number;
  cachedInputTokens: number | null;
  outputTokens: number;
  latencyMs: number | null;
  threadId: string | null;
  createdAt: string;
};

export type WindowData = {
  window: Window;
  totals: Totals;
  totalsPrev: Totals;          // same-length window immediately before
  cacheSavedUsd: number;       // estimated $ saved vs no-cache baseline
  avgCostPerCall: number;
  avgCostPerSession: number;
  sessionCount: number;
  latency: { p50: number | null; p95: number | null; avg: number | null };
  series: SeriesPoint[];
  stackedByAgent: StackedSeries;
  stackedByModel: StackedSeries;
  stackedByCallKind: StackedSeries;
  byModel: BreakdownRow[];
  byAgent: BreakdownRow[];
  byCallKind: BreakdownRow[];
  byProject: BreakdownRow[];
  byMember: BreakdownRow[];
  topSessions: TopSession[];
  topCalls: TopCall[];
};

const ZERO: Totals = {
  costUsd: 0,
  calls: 0,
  inputTokens: 0,
  cachedInputTokens: 0,
  outputTokens: 0,
  reasoningTokens: 0,
};

type HourlyRow = {
  bucket_hour: string | null;
  agent_name: string | null;
  model_id: string | null;
  call_kind: string | null;
  project_id: string | null;
  member_id: string | null;
  calls: number | null;
  cost_usd: number | null;
  input_tokens: number | null;
  cached_input_tokens: number | null;
  output_tokens: number | null;
  reasoning_tokens: number | null;
};

function addTotals(into: Totals, row: HourlyRow): Totals {
  return {
    costUsd: into.costUsd + Number(row.cost_usd ?? 0),
    calls: into.calls + (row.calls ?? 0),
    inputTokens: into.inputTokens + (row.input_tokens ?? 0),
    cachedInputTokens: into.cachedInputTokens + (row.cached_input_tokens ?? 0),
    outputTokens: into.outputTokens + (row.output_tokens ?? 0),
    reasoningTokens: into.reasoningTokens + (row.reasoning_tokens ?? 0),
  };
}

function emptyBreakdown(key: string, label: string): BreakdownRow {
  return {
    key, label,
    costUsd: 0, calls: 0,
    inputTokens: 0, cachedInputTokens: 0, outputTokens: 0, reasoningTokens: 0,
    cacheSavedUsd: 0,
  };
}

function addBreakdown(r: BreakdownRow, row: HourlyRow, savedUsd: number): BreakdownRow {
  r.costUsd += Number(row.cost_usd ?? 0);
  r.calls += row.calls ?? 0;
  r.inputTokens += row.input_tokens ?? 0;
  r.cachedInputTokens += row.cached_input_tokens ?? 0;
  r.outputTokens += row.output_tokens ?? 0;
  r.reasoningTokens += row.reasoning_tokens ?? 0;
  r.cacheSavedUsd += savedUsd;
  return r;
}

function bucketOf(date: Date, kind: "hour" | "day"): string {
  const d = new Date(date);
  if (kind === "hour") {
    d.setUTCMinutes(0, 0, 0);
  } else {
    d.setUTCHours(0, 0, 0, 0);
  }
  return d.toISOString();
}

function buildEmptySeries(start: Date, end: Date, kind: "hour" | "day"): SeriesPoint[] {
  const out: SeriesPoint[] = [];
  const stepMs = kind === "hour" ? 60 * 60 * 1000 : 24 * 60 * 60 * 1000;
  const cursor = new Date(start);
  if (kind === "hour") cursor.setUTCMinutes(0, 0, 0);
  else cursor.setUTCHours(0, 0, 0, 0);

  while (cursor.getTime() <= end.getTime()) {
    out.push({ bucket: cursor.toISOString(), costUsd: 0, calls: 0 });
    cursor.setTime(cursor.getTime() + stepMs);
  }
  return out;
}

function buildStackedSeries(
  rows: HourlyRow[],
  start: Date,
  end: Date,
  kind: "hour" | "day",
  dim: (r: HourlyRow) => string,
): StackedSeries {
  const buckets = buildEmptySeries(start, end, kind).map((p) => p.bucket);
  const keys = new Set<string>();
  const byBucket = new Map<string, Record<string, number>>();
  for (const b of buckets) byBucket.set(b, {});

  for (const r of rows) {
    if (!r.bucket_hour) continue;
    const bucket = bucketOf(new Date(r.bucket_hour), kind);
    const slot = byBucket.get(bucket);
    if (!slot) continue;
    const key = dim(r);
    keys.add(key);
    slot[key] = (slot[key] ?? 0) + Number(r.cost_usd ?? 0);
  }

  const keyList = [...keys].sort();
  const data: StackedSeriesPoint[] = buckets.map((bucket) => {
    const slot = byBucket.get(bucket) ?? {};
    const point: StackedSeriesPoint = { bucket };
    for (const k of keyList) point[k] = Number((slot[k] ?? 0).toFixed(6));
    return point;
  });
  return { keys: keyList, data };
}

function percentile(sorted: number[], p: number): number | null {
  if (sorted.length === 0) return null;
  const idx = Math.max(0, Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[idx];
}

/**
 * Loads the full dashboard payload for a window.
 *
 * Uses agent_usage_hourly_mv for aggregations (cost/tokens by dimension and
 * timeseries), and AgentUsage raw for latency percentiles and "top calls"
 * outliers. memberId/projectId names are joined in a second pass.
 */
export type AgentOverviewRow = {
  agentName: string;
  costUsd: number;
  callsCurr: number;
  costUsdPrev: number;
  cacheRatio: number;          // cached_input / input
};

/**
 * Lightweight per-agent rollup for the /agents hub cards.
 * Returns one row per agentName seen in the last 14 days (current 7d + previous 7d).
 */
export async function loadAgentsOverview(): Promise<Map<string, AgentOverviewRow>> {
  const supabase = await createClient();
  const now = Date.now();
  const windowMs = 7 * 24 * 60 * 60 * 1000;
  const start = new Date(now - windowMs).toISOString();
  const prevStart = new Date(now - 2 * windowMs).toISOString();

  const { data } = await supabase
    .from("agent_usage_hourly_mv")
    .select("agent_name, bucket_hour, calls, cost_usd, input_tokens, cached_input_tokens")
    .gte("bucket_hour", prevStart);

  type Acc = AgentOverviewRow & { _input: number; _cached: number };
  const map = new Map<string, Acc>();

  for (const r of (data ?? []) as Array<{
    agent_name: string | null;
    bucket_hour: string | null;
    calls: number | null;
    cost_usd: number | null;
    input_tokens: number | null;
    cached_input_tokens: number | null;
  }>) {
    if (!r.agent_name || !r.bucket_hour) continue;
    const isCurr = r.bucket_hour >= start;
    const row = map.get(r.agent_name) ?? {
      agentName: r.agent_name,
      costUsd: 0,
      callsCurr: 0,
      costUsdPrev: 0,
      cacheRatio: 0,
      _input: 0,
      _cached: 0,
    };
    const cost = Number(r.cost_usd ?? 0);
    if (isCurr) {
      row.costUsd += cost;
      row.callsCurr += r.calls ?? 0;
      row._input += r.input_tokens ?? 0;
      row._cached += r.cached_input_tokens ?? 0;
    } else {
      row.costUsdPrev += cost;
    }
    map.set(r.agent_name, row);
  }

  const out = new Map<string, AgentOverviewRow>();
  for (const [name, acc] of map) {
    out.set(name, {
      agentName: acc.agentName,
      costUsd: acc.costUsd,
      callsCurr: acc.callsCurr,
      costUsdPrev: acc.costUsdPrev,
      cacheRatio: acc._input > 0 ? acc._cached / acc._input : 0,
    });
  }
  return out;
}

export type LoadUsageOpts = {
  window: Window;
  /** When set, restrict all aggregations and outliers to a single agent. */
  agentFilter?: string;
};

export async function loadUsageWindow(opts: Window | LoadUsageOpts): Promise<WindowData> {
  const { window, agentFilter } = typeof opts === "string" ? { window: opts, agentFilter: undefined } : opts;
  const spec = WINDOWS[window];
  const now = Date.now();
  const start = new Date(now - spec.ms);
  const prevStart = new Date(now - 2 * spec.ms);
  const supabase = await createClient();

  const mvQuery = supabase
    .from("agent_usage_hourly_mv")
    .select("*")
    .gte("bucket_hour", prevStart.toISOString());
  const rawLatQuery = supabase
    .from("AgentUsage")
    .select("latencyMs, createdAt")
    .gte("createdAt", start.toISOString())
    .not("latencyMs", "is", null);
  const sessionsQuery = supabase
    .from("AgentUsage")
    .select("id, agentName, costUsd, latencyMs, threadId, createdAt")
    .gte("createdAt", start.toISOString())
    .not("threadId", "is", null);
  const topCallsQuery = supabase
    .from("AgentUsage")
    .select("id, agentName, modelId, callKind, costUsd, promptTokens, cachedPromptTokens, completionTokens, latencyMs, threadId, createdAt")
    .gte("createdAt", start.toISOString())
    .order("costUsd", { ascending: false })
    .limit(10);

  if (agentFilter) {
    mvQuery.eq("agent_name", agentFilter);
    rawLatQuery.eq("agentName", agentFilter);
    sessionsQuery.eq("agentName", agentFilter);
    topCallsQuery.eq("agentName", agentFilter);
  }

  // 1. Aggregated rollup for current + previous window (one query, partition in JS)
  const [aggRes, rawRes, sessionsRes, topCallsRes] = await Promise.all([
    mvQuery,
    rawLatQuery,
    sessionsQuery,
    topCallsQuery,
  ]);

  const allRows = (aggRes.data ?? []) as HourlyRow[];
  const currRows: HourlyRow[] = [];
  const prevRows: HourlyRow[] = [];
  for (const r of allRows) {
    if (!r.bucket_hour) continue;
    if (r.bucket_hour >= start.toISOString()) currRows.push(r);
    else prevRows.push(r);
  }

  // 2. Totals
  let totals = { ...ZERO };
  let totalsPrev = { ...ZERO };
  for (const r of currRows) totals = addTotals(totals, r);
  for (const r of prevRows) totalsPrev = addTotals(totalsPrev, r);

  // 3. Series (bucket-empty filled)
  const seriesIdx = new Map<string, SeriesPoint>();
  const emptySeries = buildEmptySeries(start, new Date(now), spec.bucket);
  for (const p of emptySeries) seriesIdx.set(p.bucket, p);

  for (const r of currRows) {
    if (!r.bucket_hour) continue;
    const bucket = bucketOf(new Date(r.bucket_hour), spec.bucket);
    const pt = seriesIdx.get(bucket);
    if (pt) {
      pt.costUsd += Number(r.cost_usd ?? 0);
      pt.calls += r.calls ?? 0;
    }
  }
  const series = [...seriesIdx.values()].sort((a, b) => a.bucket.localeCompare(b.bucket));

  const endDate = new Date(now);
  const stackedByAgent = buildStackedSeries(currRows, start, endDate, spec.bucket, (r) => r.agent_name ?? "?");
  const stackedByModel = buildStackedSeries(currRows, start, endDate, spec.bucket, (r) => modelFamily(r.model_id ?? "?"));
  const stackedByCallKind = buildStackedSeries(currRows, start, endDate, spec.bucket, (r) => r.call_kind ?? "?");

  // 4. Breakdowns
  const byModel = new Map<string, BreakdownRow>();
  const byAgent = new Map<string, BreakdownRow>();
  const byCallKind = new Map<string, BreakdownRow>();
  const byProject = new Map<string, BreakdownRow>();
  const byMember = new Map<string, BreakdownRow>();

  for (const r of currRows) {
    const modelKey = r.model_id ?? "?";
    const family = modelFamily(modelKey);
    const saved = estimateCacheSavingsUsd(modelKey, r.cached_input_tokens ?? 0);

    addBreakdown(byModel.get(family) ?? byModel.set(family, emptyBreakdown(family, family)).get(family)!, r, saved);

    const agent = r.agent_name ?? "?";
    addBreakdown(byAgent.get(agent) ?? byAgent.set(agent, emptyBreakdown(agent, agent)).get(agent)!, r, saved);

    const ck = r.call_kind ?? "?";
    addBreakdown(byCallKind.get(ck) ?? byCallKind.set(ck, emptyBreakdown(ck, ck)).get(ck)!, r, saved);

    const pid = r.project_id ?? "—";
    addBreakdown(byProject.get(pid) ?? byProject.set(pid, emptyBreakdown(pid, pid)).get(pid)!, r, saved);

    const mid = r.member_id ?? "—";
    addBreakdown(byMember.get(mid) ?? byMember.set(mid, emptyBreakdown(mid, mid)).get(mid)!, r, saved);
  }

  // 5. Hydrate project/member names
  const projectIds = [...byProject.keys()].filter((k) => k !== "—");
  const memberIds = [...byMember.keys()].filter((k) => k !== "—");

  const [projectRes, memberRes] = await Promise.all([
    projectIds.length
      ? supabase.from("Project").select("id, name").in("id", projectIds)
      : Promise.resolve({ data: [] as Array<{ id: string; name: string }> }),
    memberIds.length
      ? supabase.from("Member").select("id, name").in("id", memberIds)
      : Promise.resolve({ data: [] as Array<{ id: string; name: string | null }> }),
  ]);

  for (const p of (projectRes.data ?? []) as Array<{ id: string; name: string | null }>) {
    const row = byProject.get(p.id);
    if (row) row.label = p.name ?? p.id;
  }
  for (const m of (memberRes.data ?? []) as Array<{ id: string; name: string | null }>) {
    const row = byMember.get(m.id);
    if (row) row.label = m.name ?? m.id;
  }
  const noProject = byProject.get("—"); if (noProject) noProject.label = "(sem projeto)";
  const noMember = byMember.get("—"); if (noMember) noMember.label = "(sem membro)";

  // 6. Latency percentiles + sessions + top calls
  const rawRows = (rawRes.data ?? []) as Array<{ latencyMs: number | null; createdAt: string }>;
  const latencies = rawRows
    .map((r) => r.latencyMs)
    .filter((n): n is number => typeof n === "number" && n >= 0)
    .sort((a, b) => a - b);
  const avgLat = latencies.length ? latencies.reduce((a, b) => a + b, 0) / latencies.length : null;

  const sessions = (sessionsRes.data ?? []) as Array<{
    id: string;
    agentName: string;
    costUsd: number | string;
    latencyMs: number | null;
    threadId: string | null;
    createdAt: string;
  }>;
  const sessionMap = new Map<string, { cost: number; calls: number; agentName: string; latestAt: string; latencies: number[] }>();
  for (const r of sessions) {
    if (!r.threadId) continue;
    const cur = sessionMap.get(r.threadId) ?? { cost: 0, calls: 0, agentName: r.agentName, latestAt: r.createdAt, latencies: [] };
    cur.cost += Number(r.costUsd ?? 0);
    cur.calls += 1;
    if (r.createdAt > cur.latestAt) cur.latestAt = r.createdAt;
    if (typeof r.latencyMs === "number") cur.latencies.push(r.latencyMs);
    sessionMap.set(r.threadId, cur);
  }
  const topSessions: TopSession[] = [...sessionMap.entries()]
    .map(([threadId, s]) => ({
      threadId,
      agentName: s.agentName,
      costUsd: s.cost,
      calls: s.calls,
      latestAt: s.latestAt,
      avgLatencyMs: s.latencies.length ? s.latencies.reduce((a, b) => a + b, 0) / s.latencies.length : null,
    }))
    .sort((a, b) => b.costUsd - a.costUsd)
    .slice(0, 10);

  const topCalls: TopCall[] = ((topCallsRes.data ?? []) as Array<{
    id: string;
    agentName: string;
    modelId: string;
    callKind: string;
    costUsd: number | string;
    promptTokens: number;
    cachedPromptTokens: number | null;
    completionTokens: number;
    latencyMs: number | null;
    threadId: string | null;
    createdAt: string;
  }>).map((r) => ({
    id: r.id,
    agentName: r.agentName,
    modelId: r.modelId,
    callKind: r.callKind,
    costUsd: Number(r.costUsd ?? 0),
    inputTokens: r.promptTokens,
    cachedInputTokens: r.cachedPromptTokens,
    outputTokens: r.completionTokens,
    latencyMs: r.latencyMs,
    threadId: r.threadId,
    createdAt: r.createdAt,
  }));

  // 7. Derived metrics
  const cacheSavedUsd = [...byModel.values()].reduce((a, r) => a + r.cacheSavedUsd, 0);
  const sessionCount = sessionMap.size;
  const avgCostPerCall = totals.calls > 0 ? totals.costUsd / totals.calls : 0;
  const avgCostPerSession = sessionCount > 0 ? totals.costUsd / sessionCount : 0;

  const sortBreakdown = (m: Map<string, BreakdownRow>): BreakdownRow[] =>
    [...m.values()].sort((a, b) => b.costUsd - a.costUsd);

  return {
    window,
    totals,
    totalsPrev,
    cacheSavedUsd,
    avgCostPerCall,
    avgCostPerSession,
    sessionCount,
    latency: { p50: percentile(latencies, 50), p95: percentile(latencies, 95), avg: avgLat },
    series,
    stackedByAgent,
    stackedByModel,
    stackedByCallKind,
    byModel: sortBreakdown(byModel),
    byAgent: sortBreakdown(byAgent),
    byCallKind: sortBreakdown(byCallKind),
    byProject: sortBreakdown(byProject),
    byMember: sortBreakdown(byMember),
    topSessions,
    topCalls,
  };
}
