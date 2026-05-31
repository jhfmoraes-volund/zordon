import { NextResponse } from "next/server";
import { getEffectiveAccessLevel } from "@/lib/dal";
import { hasMinAccessLevel } from "@/lib/roles";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

type EventOut = {
  seq: number;
  kind: string;
  ts: string;
  payload: Record<string, unknown> | null;
};

type RunSummary = {
  id: string;
  status: string;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  durationMs: number | null;
};

/**
 * GET /api/forge/projects/[id]/prds/[prdId]/execution
 *
 * Retorna tudo que a tab "Execução" do PRD precisa:
 * - PRD AC + reference (pra checklist estático)
 * - Lista de runs que cobriram esse PRD (manifest contém PRD.reference)
 * - activeRun (queued/running) e lastFinishedRun
 * - Stream de eventos do run mais relevante, filtrados por taskId=PRD.reference
 *   ou payload.storyId=PRD.reference
 */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string; prdId: string }> },
) {
  const { id: projectId, prdId } = await params;

  const accessLevel = await getEffectiveAccessLevel();
  if (!hasMinAccessLevel(accessLevel, "manager")) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const supabase = db();

  const { data: prd, error: prdErr } = await supabase
    .from("ProductRequirement")
    .select("id, reference, title, status, acceptanceCriteria, projectId")
    .eq("id", prdId)
    .maybeSingle();
  if (prdErr || !prd) {
    return NextResponse.json({ error: "prd_not_found" }, { status: 404 });
  }
  if (prd.projectId !== projectId) {
    return NextResponse.json({ error: "mismatch" }, { status: 400 });
  }

  // Lista runs do projeto (ordenados desc) e filtra pelos que contém esse PRD no manifest.
  const { data: runs, error: runsErr } = await supabase
    .from("ForgeRun")
    .select("id, status, createdAt, manifest")
    .eq("projectId", projectId)
    .order("createdAt", { ascending: false })
    .limit(20);
  if (runsErr) {
    return NextResponse.json({ error: runsErr.message }, { status: 500 });
  }

  type ManifestPrd = { reference?: string };
  const coveringRuns = (runs ?? []).filter((r) => {
    const m = r.manifest as { prds?: ManifestPrd[] } | null;
    return (m?.prds ?? []).some((p) => p.reference === prd.reference);
  });

  // Histórico: ids + status + timestamps. Pra startedAt/finishedAt cruzamos
  // com ForgeEvent (story_picked / story_done|story_failed).
  const runIds = coveringRuns.map((r) => r.id);

  const eventsByRun = new Map<string, EventOut[]>();
  if (runIds.length > 0) {
    const { data: eventRows } = await supabase
      .from("ForgeEvent")
      .select("runId, seq, kind, ts, payload, taskId")
      .in("runId", runIds)
      .order("seq", { ascending: true });

    for (const row of (eventRows ?? []) as Array<{
      runId: string;
      seq: number;
      kind: string;
      ts: string;
      payload: Record<string, unknown> | null;
      taskId: string | null;
    }>) {
      const storyId =
        (row.payload &&
        typeof row.payload === "object" &&
        "storyId" in row.payload &&
        typeof (row.payload as { storyId: unknown }).storyId === "string"
          ? ((row.payload as { storyId: string }).storyId)
          : null) ??
        row.taskId ??
        null;

      // Pra eventos com storyId definido, só inclui se for desse PRD.
      // Eventos sem storyId (started, claude_system…) entram em todos os PRDs
      // do run — mas pra esta visão por PRD, ignoramos esses orchestrator-level
      // events e mostramos só os do PRD em questão.
      if (storyId !== prd.reference) continue;

      const list = eventsByRun.get(row.runId) ?? [];
      list.push({
        seq: row.seq,
        kind: row.kind,
        ts: row.ts,
        payload: row.payload,
      });
      eventsByRun.set(row.runId, list);
    }
  }

  const runSummaries: RunSummary[] = coveringRuns.map((r) => {
    const evs = eventsByRun.get(r.id) ?? [];
    let startedAt: string | null = null;
    let finishedAt: string | null = null;
    for (const ev of evs) {
      if (ev.kind === "story_picked" && !startedAt) startedAt = ev.ts;
      if (ev.kind === "story_done" || ev.kind === "story_failed")
        finishedAt = ev.ts;
    }
    const durationMs =
      startedAt && finishedAt
        ? new Date(finishedAt).getTime() - new Date(startedAt).getTime()
        : startedAt && (r.status === "running" || r.status === "queued")
          ? Date.now() - new Date(startedAt).getTime()
          : null;
    return {
      id: r.id,
      status: r.status,
      createdAt: r.createdAt,
      startedAt,
      finishedAt,
      durationMs,
    };
  });

  const activeRun =
    runSummaries.find((r) => r.status === "queued" || r.status === "running") ??
    null;
  const lastFinishedRun =
    runSummaries.find(
      (r) =>
        r.status === "done" ||
        r.status === "error" ||
        r.status === "aborted",
    ) ?? null;

  // Stream: eventos do run mais relevante (ativo > último finalizado).
  const focusRun = activeRun ?? lastFinishedRun;
  const events: EventOut[] = focusRun
    ? eventsByRun.get(focusRun.id) ?? []
    : [];

  return NextResponse.json({
    prd: {
      id: prd.id,
      reference: prd.reference,
      title: prd.title,
      status: prd.status,
      acceptanceCriteria: prd.acceptanceCriteria,
    },
    activeRun,
    lastFinishedRun,
    focusRunId: focusRun?.id ?? null,
    history: runSummaries,
    events,
  });
}
