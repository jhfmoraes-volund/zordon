import { NextResponse } from "next/server";
import { getEffectiveAccessLevel } from "@/lib/dal";
import { hasMinAccessLevel } from "@/lib/roles";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

/**
 * POST /api/forge/runs/[id]/cancel
 *
 * Marca ForgeRun como cancelled e cancela o ForgeJob associado.
 *
 * - Se job=queued: cancela limpo, daemon nunca pega.
 * - Se job=running: marca cancelled, mas worker já em execução **continua**
 *   até terminar a story atual (daemon ainda não envia SIGTERM ao worker).
 *   Próxima story do manifest não inicia.
 */
export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: runId } = await params;

  const accessLevel = await getEffectiveAccessLevel();
  if (!hasMinAccessLevel(accessLevel, "manager")) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const supabase = db();

  const { data: run, error: runErr } = await supabase
    .from("ForgeRun")
    .select("id, status")
    .eq("id", runId)
    .maybeSingle();
  if (runErr) {
    return NextResponse.json({ error: runErr.message }, { status: 500 });
  }
  if (!run) {
    return NextResponse.json({ error: "run_not_found" }, { status: 404 });
  }
  if (run.status !== "queued" && run.status !== "running") {
    return NextResponse.json(
      { error: `run is ${run.status}, cannot cancel` },
      { status: 400 },
    );
  }

  // Marca ForgeRun.status=cancelled.
  const { error: updErr } = await supabase
    .from("ForgeRun")
    .update({ status: "aborted" })
    .eq("id", runId);
  if (updErr) {
    return NextResponse.json({ error: updErr.message }, { status: 500 });
  }

  // Marca ForgeJob.status=cancelled (ForgeJob aceita 'cancelled', ForgeRun aceita 'aborted').
  // Daemon detecta cancelled e para de spawn novas stories.
  const { error: jobErr } = await supabase
    .from("ForgeJob")
    .update({ status: "cancelled" })
    .eq("runId", runId)
    .in("status", ["queued", "claimed", "running"]);
  if (jobErr) {
    console.error("[cancel run] job update failed:", jobErr);
    // Run já tá cancelled, não rollback. Daemon vai detectar mismatch.
  }

  return NextResponse.json({ ok: true, runId });
}
