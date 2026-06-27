// POST /api/clients/[id]/insights/rerun
//
// Manual rerun of the client-level insight. Same rate-limit + in-flight guard
// as the project rerun. Manager+ only.

import { NextResponse, type NextRequest } from "next/server";
import { db } from "@/lib/db";
import { getMemberId } from "@/lib/dal";
import { requireCapabilityApi } from "@/lib/access/require-capability";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const RATE_LIMIT_MINUTES = 60;

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: clientId } = await params;

  const denied = await requireCapabilityApi("client.write");
  if (denied) return denied;

  const supabase = db();

  const cutoff = new Date(Date.now() - RATE_LIMIT_MINUTES * 60_000).toISOString();
  const { data: recent } = await supabase
    .from("InsightJob")
    .select("createdAt")
    .eq("clientId", clientId)
    .eq("kind", "client")
    .eq("source", "manual")
    .gte("createdAt", cutoff)
    .order("createdAt", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (recent) {
    const elapsed = Date.now() - new Date(recent.createdAt).getTime();
    const retryAfterSec = Math.ceil((RATE_LIMIT_MINUTES * 60_000 - elapsed) / 1000);
    return NextResponse.json(
      {
        error: "rate_limited",
        retryAfterSec,
        message: `Próximo rerun manual em ~${Math.ceil(retryAfterSec / 60)} min.`,
      },
      { status: 429 },
    );
  }

  const { data: inFlight } = await supabase
    .from("InsightJob")
    .select("id, status")
    .eq("clientId", clientId)
    .eq("kind", "client")
    .in("status", ["pending", "running"])
    .limit(1)
    .maybeSingle();

  if (inFlight) {
    return NextResponse.json(
      { error: "in_flight", jobId: inFlight.id, status: inFlight.status },
      { status: 409 },
    );
  }

  const memberId = await getMemberId();

  const { data: job, error: insertErr } = await supabase
    .from("InsightJob")
    .insert({
      clientId,
      kind: "client",
      source: "manual",
      triggeredByMemberId: memberId,
    })
    .select("id")
    .single();

  if (insertErr || !job) {
    return NextResponse.json(
      { error: "insert_failed", message: insertErr?.message ?? "unknown" },
      { status: 500 },
    );
  }

  // Best-effort kick — same pattern as the project rerun.
  const cronUrl = new URL("/api/cron/run-alpha-insights", req.url);
  const token = process.env.INSIGHTS_AUTH_TOKEN;
  if (token) {
    fetch(cronUrl.toString(), {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ jobId: job.id }),
    }).catch((e) => {
      console.warn("[clients/insights/rerun] drain kick failed:", (e as Error).message);
    });
  }

  return NextResponse.json({ ok: true, jobId: job.id }, { status: 202 });
}
