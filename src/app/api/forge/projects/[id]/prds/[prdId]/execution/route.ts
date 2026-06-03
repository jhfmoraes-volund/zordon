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

  type ManifestStory = { id?: string };
  type ManifestPrd = { reference?: string; stories?: ManifestStory[] };
  const coveringRuns = (runs ?? []).filter((r) => {
    const m = r.manifest as { prds?: ManifestPrd[] } | null;
    return (m?.prds ?? []).some((p) => p.reference === prd.reference);
  });

  // Cada run tem seu próprio snapshot de stories no manifest. Um PRD vira N
  // stories com ids próprios (ex: SIAL-DENA-001..005), distintos do
  // PRD.reference (SIAL-PRD-019). Os ForgeEvent carregam payload.storyId =
  // story.id, então pra filtrar os eventos deste PRD precisamos do conjunto de
  // story ids por run — não dá pra comparar com prd.reference direto.
  const storyIdsByRun = new Map<string, Set<string>>();
  for (const r of coveringRuns) {
    const m = r.manifest as { prds?: ManifestPrd[] } | null;
    const entry = (m?.prds ?? []).find((p) => p.reference === prd.reference);
    const ids = new Set<string>();
    for (const s of entry?.stories ?? []) {
      if (typeof s.id === "string") ids.add(s.id);
    }
    // Legado: snapshots antigos usavam story.id === PRD.reference.
    ids.add(prd.reference);
    storyIdsByRun.set(r.id, ids);
  }

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

      // Só inclui eventos cujo storyId pertence a uma das stories deste PRD
      // (conjunto derivado do manifest do run). Eventos orchestrator-level sem
      // storyId (autorun_started, manifest_bootstrapped…) ficam de fora desta
      // visão por PRD.
      const prdStoryIds = storyIdsByRun.get(row.runId);
      if (!storyId || !prdStoryIds?.has(storyId)) continue;

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
