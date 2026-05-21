// POST /api/cron/run-alpha-insights
//
// Drains pending InsightJob rows. Triggered by pg_cron (via pg_net) once a
// day and by the manual rerun route. Auth is a shared bearer secret
// (INSIGHTS_AUTH_TOKEN) — no user JWT.
//
// Body:
//   { jobId?: string }        // when set, process this one job and exit
//                             // when omitted, drain up to MAX_JOBS pending
//
// Response: { ok: true, processed: N, results: RunJobResult[] }

import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  claimNextJob,
  runInsightJob,
  type ClaimedJob,
  type RunJobResult,
} from "@/lib/insights/run-job";
import {
  runClientInsightJob,
  type RunClientJobResult,
} from "@/lib/insights/run-client-job";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";

type AnyResult =
  | (RunJobResult & { kind: "project" })
  | (RunClientJobResult & { kind: "client" });

async function dispatchJob(
  admin: SupabaseClient<Database>,
  job: ClaimedJob,
): Promise<AnyResult> {
  if (job.kind === "client") {
    const r = await runClientInsightJob(admin, job);
    return { ...r, kind: "client" };
  }
  const r = await runInsightJob(admin, job);
  return { ...r, kind: "project" };
}

// Keep alpha/chat's precedent: structured-output LLM calls take ~15s each;
// drain mode of up to 10 jobs would otherwise hit Next.js's 10s default.
export const maxDuration = 300;
export const dynamic = "force-dynamic";

const MAX_JOBS_PER_INVOCATION = 10;

export async function POST(req: Request) {
  const token = process.env.INSIGHTS_AUTH_TOKEN;
  if (!token) {
    return new Response("Server misconfigured: INSIGHTS_AUTH_TOKEN missing", { status: 500 });
  }

  const auth = req.headers.get("authorization");
  if (auth !== `Bearer ${token}`) {
    return new Response("Unauthorized", { status: 401 });
  }

  const body = await req.json().catch(() => ({} as Record<string, unknown>));
  const jobId = typeof body?.jobId === "string" ? body.jobId : undefined;

  const admin = createAdminClient();
  const results: AnyResult[] = [];

  if (jobId) {
    const job = await claimNextJob(admin, jobId);
    if (!job) {
      return NextResponse.json(
        { ok: false, reason: "job not found or already claimed" },
        { status: 404 },
      );
    }
    results.push(await dispatchJob(admin, job));
  } else {
    for (let i = 0; i < MAX_JOBS_PER_INVOCATION; i++) {
      const job = await claimNextJob(admin);
      if (!job) break;
      results.push(await dispatchJob(admin, job));
    }
  }

  return NextResponse.json({ ok: true, processed: results.length, results });
}
