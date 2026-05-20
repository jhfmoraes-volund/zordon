// POST /api/projects/[id]/insights/rerun
//
// Manual rerun of the project insight. Enqueues an InsightJob with
// source='manual' and triggers the drain by invoking the cron route
// internally. Rate-limited to 1 manual run per project per hour so PMs can't
// burn the OpenRouter budget by reflex-clicking.

import { NextResponse, type NextRequest } from "next/server";
import { db } from "@/lib/db";
import { requireProjectEditTasksApi, getMemberId } from "@/lib/dal";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const RATE_LIMIT_MINUTES = 60;

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: projectId } = await params;

  const denied = await requireProjectEditTasksApi(projectId);
  if (denied) return denied;

  const supabase = db();

  // Rate-limit: last manual job for this project, regardless of outcome.
  const cutoff = new Date(Date.now() - RATE_LIMIT_MINUTES * 60_000).toISOString();
  const { data: recent } = await supabase
    .from("InsightJob")
    .select("createdAt")
    .eq("projectId", projectId)
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

  // Block reruns when a job is already running. Avoids race where two manual
  // reruns get drained concurrently and only the second one's row survives.
  const { data: inFlight } = await supabase
    .from("InsightJob")
    .select("id, status")
    .eq("projectId", projectId)
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
      projectId,
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

  // Kick the drain via the cron route. This is internal — we don't expose
  // the token to the browser. Best-effort: if the kick fails the job stays
  // in the queue and the next cron tick or rerun picks it up.
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
      console.warn("[insights/rerun] drain kick failed:", (e as Error).message);
    });
  }

  return NextResponse.json({ ok: true, jobId: job.id }, { status: 202 });
}
