/**
 * E2E diagnosis phase D/E: run the PM Review refresh for RIPLE 1/2 now that
 * ContextSource is populated, then poll for the daemon (Vitoria) to synthesize
 * the report. TEMP diagnostic — delete after.
 */
import { createAdminClient } from "@/lib/supabase/admin";
import { refreshPMReviewForProject, resolvePMReviewOwner } from "@/lib/pm-review/refresh";

const RIPLE = [
  ["Riple 1", "2bba2f4b-fae3-4465-b03f-0c3842ef47ec"],
  ["Riple 2", "60043424-515a-4684-809e-174d185eef25"],
] as const;

function hr(s: string) { console.log(`\n=== ${s} ===`); }
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function snapshot(admin: ReturnType<typeof createAdminClient>, pid: string) {
  const { data: pr } = await admin
    .from("PMReview")
    .select('id, "referenceWeek", status, "reportGeneratedAt", "reportMarkdown"')
    .eq("projectId", pid).eq("referenceWeek", "2026-06-15").maybeSingle();
  let turn: { status: string } | null = null;
  if (pr?.id) {
    const { data: t } = await admin
      .from("ChatThread")
      .select("id")
      .eq("channel", "pm_review").eq("agentName", pr.id as string).maybeSingle();
    if (t?.id) {
      const { data: ct } = await admin
        .from("ChatTurn").select("status").eq("threadId", t.id as string)
        .order("createdAt", { ascending: false }).limit(1).maybeSingle();
      turn = ct ? { status: ct.status as string } : null;
    }
  }
  return {
    pmReviewId: pr?.id ?? null,
    status: pr?.status ?? null,
    reportLen: (pr?.reportMarkdown as string | null)?.length ?? 0,
    reportGenerated: pr?.reportGeneratedAt ?? null,
    lastTurn: turn?.status ?? null,
  };
}

async function main() {
  const admin = createAdminClient();

  hr("REFRESH");
  for (const [name, pid] of RIPLE) {
    const owner = await resolvePMReviewOwner(admin, pid);
    const out = await refreshPMReviewForProject(admin, pid, owner ?? "");
    console.log(`  ${name}: owner=${owner} -> ${JSON.stringify(out)}`);
  }

  hr("POLL daemon synthesis (up to ~4 min)");
  for (let i = 0; i < 16; i++) {
    const lines: string[] = [];
    let allDone = true;
    for (const [name, pid] of RIPLE) {
      const s = await snapshot(admin, pid);
      lines.push(`${name}[turn=${s.lastTurn} report=${s.reportLen}b]`);
      if (s.reportLen === 0) allDone = false;
    }
    console.log(`  t+${i * 15}s  ${lines.join("  ")}`);
    if (allDone) { console.log("  -> both reports synthesized."); break; }
    await sleep(15000);
  }

  hr("FINAL SNAPSHOT");
  for (const [name, pid] of RIPLE) {
    const s = await snapshot(admin, pid);
    console.log(`  ${name}:`, JSON.stringify({ ...s, reportHead: undefined }));
  }
}

main().then(() => process.exit(0)).catch((e) => { console.error("FAIL:", e); process.exit(1); });
