/**
 * E2E diagnosis (RIPLE 1/2): unwedge the Granola import queue, set cursor to
 * catch the 20/06 test notes, enqueue+claim+run a real import job, verify
 * ContextSource fills. Direct function calls — bypasses the (broken) HTTP route.
 * TEMP diagnostic script — delete after.
 */
import { createAdminClient } from "@/lib/supabase/admin";
import {
  enqueueManualGranolaImport,
  claimNextGranolaJob,
  runGranolaImportJob,
} from "@/lib/granola-auto-import";

const MEMBER = "dc4d91f5-0d29-453a-b11e-d42dd6a7b158"; // João
const RIPLE1 = "2bba2f4b-fae3-4465-b03f-0c3842ef47ec";
const RIPLE2 = "60043424-515a-4684-809e-174d185eef25";
const CURSOR = "2026-06-20T15:00:00.000Z"; // before the earliest 20/06 test note (15:49)

function hr(s: string) { console.log(`\n=== ${s} ===`); }

async function ctxCounts(admin: ReturnType<typeof createAdminClient>, label: string) {
  for (const [name, pid] of [["Riple 1", RIPLE1], ["Riple 2", RIPLE2]] as const) {
    const { data } = await admin
      .from("ContextSource")
      .select('id, title, "capturedAt", "meetingId"')
      .eq("source", "granola")
      .eq("projectId", pid);
    console.log(`  [${label}] ${name}: ${data?.length ?? 0} granola source(s)`);
    for (const r of data ?? []) console.log(`      - ${r.capturedAt}  ${JSON.stringify(r.title)}  mtg=${r.meetingId}`);
  }
}

async function main() {
  const admin = createAdminClient();

  hr("PRE-STATE");
  const { data: pre } = await admin
    .from("GranolaImportJob")
    .select('id, status, source, "cursorFrom", "createdAt"')
    .eq("memberId", MEMBER)
    .in("status", ["pending", "running"]);
  console.log("  in-flight jobs:", JSON.stringify(pre));
  const { data: mi } = await admin
    .from("MemberIntegration")
    .select('"autoImportEnabled", "autoImportCursor"')
    .eq("memberId", MEMBER).eq("provider", "granola").maybeSingle();
  console.log("  integration:", JSON.stringify(mi));
  await ctxCounts(admin, "pre");

  hr("STEP 1 — unwedge (fail zombie pending/running)");
  const { data: cleared } = await admin
    .from("GranolaImportJob")
    .update({ status: "failed", error: "manually cleared (zombie) by e2e diagnosis 2026-06-21", finishedAt: new Date().toISOString() })
    .eq("memberId", MEMBER)
    .in("status", ["pending", "running"])
    .select("id");
  console.log("  cleared:", cleared?.length ?? 0, JSON.stringify(cleared));

  hr("STEP 2 — set cursor to catch 20/06 notes");
  const { error: curErr } = await admin
    .from("MemberIntegration")
    .update({ autoImportCursor: CURSOR })
    .eq("memberId", MEMBER).eq("provider", "granola");
  console.log("  cursor set to", CURSOR, "err:", curErr?.message ?? "none");

  hr("STEP 3 — enqueue manual job");
  const { enqueued, jobId } = await enqueueManualGranolaImport(admin, MEMBER);
  console.log("  enqueued:", enqueued, "jobId:", jobId);
  if (!jobId) throw new Error("no jobId");

  hr("STEP 4 — claim job");
  const job = await claimNextGranolaJob(admin, jobId);
  console.log("  claimed:", JSON.stringify(job));
  if (!job) throw new Error("claim failed");

  hr("STEP 5 — RUN IMPORT (Alpha headless per note — may take minutes)");
  const result = await runGranolaImportJob(admin, job);
  console.log("  RESULT:", JSON.stringify(result, null, 2));

  hr("POST-STATE — ContextSource after import");
  await ctxCounts(admin, "post");
}

main().then(() => process.exit(0)).catch((e) => { console.error("FAIL:", e); process.exit(1); });
