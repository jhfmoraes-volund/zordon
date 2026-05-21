// POST /api/cron/run-granola-import
//
// Drains pending GranolaImportJob rows. Triggered hourly by pg_cron (via
// pg_net + Vault) and on-demand by the member-facing run-now endpoint. Auth
// is a shared bearer secret (GRANOLA_IMPORT_AUTH_TOKEN) — no user JWT.
//
// Body:
//   { jobId?: string }   when set, processes this specific job and exits.
//                        Otherwise drains up to MAX_JOBS_PER_INVOCATION oldest
//                        pending jobs.
//
// Response: { ok: true, processed: N, results: RunImportJobResult[] }
//
// Each job runs Alpha headlessly per new Granola note. Cost-per-tick is
// roughly bounded by:
//   members_opted_in × MAX_NOTES_PER_RUN × avg_steps_per_ingest
// Today: ~5 members × 20 notes × 10 LLM calls = 1000 calls/hour worst case.
// In practice notes-per-tick is 0–2 after warm-up because the cursor catches
// up. The 300s maxDuration mirrors the alpha-insights drain route.

import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  claimNextGranolaJob,
  runGranolaImportJob,
  type RunImportJobResult,
} from "@/lib/granola-auto-import";

export const maxDuration = 300;
export const dynamic = "force-dynamic";

const MAX_JOBS_PER_INVOCATION = 5;

export async function POST(req: Request) {
  const token = process.env.GRANOLA_IMPORT_AUTH_TOKEN;
  if (!token) {
    return new Response(
      "Server misconfigured: GRANOLA_IMPORT_AUTH_TOKEN missing",
      { status: 500 },
    );
  }

  const auth = req.headers.get("authorization");
  if (auth !== `Bearer ${token}`) {
    return new Response("Unauthorized", { status: 401 });
  }

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const jobId = typeof body?.jobId === "string" ? body.jobId : undefined;

  const admin = createAdminClient();
  const results: RunImportJobResult[] = [];

  if (jobId) {
    const job = await claimNextGranolaJob(admin, jobId);
    if (!job) {
      return NextResponse.json(
        { ok: false, reason: "job not found or already claimed" },
        { status: 404 },
      );
    }
    results.push(await runGranolaImportJob(admin, job));
  } else {
    for (let i = 0; i < MAX_JOBS_PER_INVOCATION; i++) {
      const job = await claimNextGranolaJob(admin);
      if (!job) break;
      results.push(await runGranolaImportJob(admin, job));
    }
  }

  return NextResponse.json({ ok: true, processed: results.length, results });
}
