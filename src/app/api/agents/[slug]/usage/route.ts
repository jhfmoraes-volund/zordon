import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireMinLevelApi } from "@/lib/dal";
import { ADMIN } from "@/lib/roles";

type Range = "7d" | "30d" | "all";

function rangeToDate(range: Range): string | null {
  if (range === "all") return null;
  const days = range === "7d" ? 7 : 30;
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString();
}

/**
 * GET /api/agents/[slug]/usage?range=7d|30d|all
 * Aggregated agent usage + cost. Admin only.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ slug: string }> },
) {
  const denied = await requireMinLevelApi(ADMIN);
  if (denied) return denied;

  const { slug } = await params;
  const range = (req.nextUrl.searchParams.get("range") as Range) || "30d";
  const supabase = db();

  // Resolve agent → name. Engine writes lowercase (e.g. "alpha"), seed stores
  // capitalised "Alpha" — we match the lowercase form.
  const { data: agent, error: agentErr } = await supabase
    .from("Agent")
    .select("id, slug, name")
    .eq("slug", slug)
    .maybeSingle();

  if (agentErr) return NextResponse.json({ error: agentErr.message }, { status: 500 });
  if (!agent) return NextResponse.json({ error: "Agent not found" }, { status: 404 });

  const agentName = agent.name.toLowerCase();
  const since = rangeToDate(range);

  // Pull all rows in the range — should be small even at 30d for a single agent.
  let q = supabase
    .from("AgentUsage")
    .select(
      "id, agentName, modelId, memberId, promptTokens, completionTokens, totalTokens, cachedPromptTokens, reasoningTokens, costUsd, threadId, createdAt",
    )
    .eq("agentName", agentName)
    .order("createdAt", { ascending: false });
  if (since) q = q.gte("createdAt", since);

  const { data: rows, error } = await q;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const list = rows ?? [];

  // Resolve member names in one go.
  const memberIds = Array.from(
    new Set(list.map((r) => r.memberId).filter((x): x is string => !!x)),
  );
  const memberMap = new Map<string, string>();
  if (memberIds.length) {
    const { data: members } = await supabase
      .from("Member")
      .select("id, name")
      .in("id", memberIds);
    for (const m of members ?? []) memberMap.set(m.id, m.name);
  }

  // Aggregates
  const totals = list.reduce(
    (acc, r) => {
      acc.calls += 1;
      acc.promptTokens += r.promptTokens || 0;
      acc.completionTokens += r.completionTokens || 0;
      acc.totalTokens += r.totalTokens || 0;
      acc.costUsd += Number(r.costUsd) || 0;
      return acc;
    },
    { calls: 0, promptTokens: 0, completionTokens: 0, totalTokens: 0, costUsd: 0 },
  );

  const byModel = new Map<
    string,
    { modelId: string; calls: number; totalTokens: number; costUsd: number }
  >();
  for (const r of list) {
    const cur = byModel.get(r.modelId) ?? {
      modelId: r.modelId,
      calls: 0,
      totalTokens: 0,
      costUsd: 0,
    };
    cur.calls += 1;
    cur.totalTokens += r.totalTokens || 0;
    cur.costUsd += Number(r.costUsd) || 0;
    byModel.set(r.modelId, cur);
  }

  const byMember = new Map<
    string,
    {
      memberId: string | null;
      memberName: string;
      calls: number;
      totalTokens: number;
      costUsd: number;
    }
  >();
  for (const r of list) {
    const key = r.memberId ?? "__null__";
    const cur = byMember.get(key) ?? {
      memberId: r.memberId,
      memberName: r.memberId ? (memberMap.get(r.memberId) ?? "—") : "Sem membro",
      calls: 0,
      totalTokens: 0,
      costUsd: 0,
    };
    cur.calls += 1;
    cur.totalTokens += r.totalTokens || 0;
    cur.costUsd += Number(r.costUsd) || 0;
    byMember.set(key, cur);
  }

  // Daily series — last 30 buckets max, useful for a sparkline / chart.
  const byDay = new Map<string, { day: string; costUsd: number; calls: number }>();
  for (const r of list) {
    const day = r.createdAt.slice(0, 10);
    const cur = byDay.get(day) ?? { day, costUsd: 0, calls: 0 };
    cur.costUsd += Number(r.costUsd) || 0;
    cur.calls += 1;
    byDay.set(day, cur);
  }

  // Recent calls — first 50 (already ordered desc).
  const recent = list.slice(0, 50).map((r) => ({
    id: r.id,
    createdAt: r.createdAt,
    modelId: r.modelId,
    promptTokens: r.promptTokens,
    completionTokens: r.completionTokens,
    totalTokens: r.totalTokens,
    cachedPromptTokens: r.cachedPromptTokens,
    reasoningTokens: r.reasoningTokens,
    costUsd: Number(r.costUsd) || 0,
    threadId: r.threadId,
    memberId: r.memberId,
    memberName: r.memberId ? (memberMap.get(r.memberId) ?? "—") : null,
  }));

  return NextResponse.json({
    range,
    agent: { slug: agent.slug, name: agent.name },
    totals,
    byModel: Array.from(byModel.values()).sort((a, b) => b.costUsd - a.costUsd),
    byMember: Array.from(byMember.values()).sort((a, b) => b.costUsd - a.costUsd),
    byDay: Array.from(byDay.values()).sort((a, b) => a.day.localeCompare(b.day)),
    recent,
  });
}
