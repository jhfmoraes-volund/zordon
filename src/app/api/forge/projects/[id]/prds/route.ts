import { NextResponse } from "next/server";
import { getEffectiveAccessLevel } from "@/lib/dal";
import { hasMinAccessLevel } from "@/lib/roles";
import { db } from "@/lib/db";
import { getPrdsForSession } from "@/lib/dal/product-requirements";

export const dynamic = "force-dynamic";

type PrdRunState = "idle" | "pending" | "running" | "done" | "failed";

type EventRow = {
  kind: string;
  ts: string;
  payload: Record<string, unknown> | null;
};

type PrdLine = {
  id: string;
  reference: string;
  title: string;
  status: string;
  oneLiner: string;
  acCount: number;
  updatedAt: string;
  runState: PrdRunState;
  runId: string | null;
  currentPhase: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  durationMs: number | null;
  lastEvents: Array<{ kind: string; ts: string; summary: string }>;
};

type ManifestPrd = { id?: string; reference?: string; title?: string };

function summarizePayload(
  kind: string,
  payload: Record<string, unknown> | null,
): string {
  if (!payload) return "";
  if (kind === "tool_use") {
    const tool = payload.tool ?? payload.name ?? "?";
    const input = payload.inputSummary ?? "";
    return `${tool}${input ? `: ${input}` : ""}`;
  }
  if (kind === "tool_result") {
    return payload.isError
      ? `error: ${String(payload.preview ?? "").slice(0, 80)}`
      : String(payload.preview ?? "").slice(0, 80);
  }
  if (kind === "assistant_text") {
    return String(payload.text ?? "").slice(0, 120);
  }
  if (kind === "story_picked") return `picked: ${payload.storyId ?? ""}`;
  if (kind === "story_done") {
    return payload.ok ? `✓ done` : `✗ failed`;
  }
  if (kind === "error") return `error: ${String(payload.message ?? "")}`;
  return "";
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: projectId } = await params;

  const accessLevel = await getEffectiveAccessLevel();
  if (!hasMinAccessLevel(accessLevel, "manager")) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const supabase = db();
  const { data: project, error: projectError } = await supabase
    .from("Project")
    .select("id, name, forgeSourceSessionId")
    .eq("id", projectId)
    .maybeSingle();

  if (projectError || !project) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  if (!project.forgeSourceSessionId) {
    return NextResponse.json({
      project: { id: project.id, name: project.name },
      sessionId: null,
      activeRunId: null,
      prds: [],
    });
  }

  const rows = await getPrdsForSession(project.forgeSourceSessionId);

  // Run ativo do projeto: queued ou running, mais recente.
  const { data: activeRuns } = await supabase
    .from("ForgeRun")
    .select("id, status, manifest, createdAt")
    .eq("projectId", projectId)
    .in("status", ["queued", "running"])
    .order("createdAt", { ascending: false })
    .limit(1);

  // Último run concluído (done/failed) — pra mostrar histórico.
  const { data: lastRuns } = await supabase
    .from("ForgeRun")
    .select("id, status, manifest, createdAt")
    .eq("projectId", projectId)
    .in("status", ["done", "error", "aborted"])
    .order("createdAt", { ascending: false })
    .limit(1);

  const activeRun = activeRuns?.[0] ?? null;
  const lastRun = lastRuns?.[0] ?? null;

  // Decide qual run "fala" por cada PRD: ativo primeiro, senão último concluído.
  const candidates = [activeRun, lastRun].filter(
    (r): r is NonNullable<typeof activeRun> => !!r,
  );

  // Quais PRD.references estão em cada run via manifest?
  const refsByRun = new Map<string, Set<string>>();
  for (const run of candidates) {
    const manifest = run.manifest as { prds?: ManifestPrd[] } | null;
    const refs = new Set(
      (manifest?.prds ?? [])
        .map((p) => p.reference)
        .filter((r): r is string => !!r),
    );
    refsByRun.set(run.id, refs);
  }

  // Buscar eventos relevantes pra os runs candidatos (1 query agregada).
  const runIds = candidates.map((r) => r.id);
  let eventsByRunByStory = new Map<string, Map<string, EventRow[]>>();
  if (runIds.length > 0) {
    const { data: rawEvents } = await supabase
      .from("ForgeEvent")
      .select("runId, taskId, kind, ts, payload")
      .in("runId", runIds)
      .order("seq", { ascending: true });

    eventsByRunByStory = new Map();
    for (const ev of (rawEvents ?? []) as Array<
      EventRow & { runId: string; taskId: string | null }
    >) {
      const storyId =
        (ev.payload &&
        typeof (ev.payload as { storyId?: unknown }).storyId === "string"
          ? ((ev.payload as { storyId: string }).storyId)
          : null) ??
        ev.taskId ??
        null;
      if (!storyId) continue;
      const runMap = eventsByRunByStory.get(ev.runId) ?? new Map();
      const list = runMap.get(storyId) ?? [];
      list.push({ kind: ev.kind, ts: ev.ts, payload: ev.payload });
      runMap.set(storyId, list);
      eventsByRunByStory.set(ev.runId, runMap);
    }
  }

  const prds: PrdLine[] = rows.map((p) => {
    const ac = Array.isArray(p.acceptanceCriteria)
      ? (p.acceptanceCriteria as unknown[])
      : [];

    // Acha o run que cobre esse PRD: ativo > último concluído.
    let coveringRun: (typeof candidates)[number] | null = null;
    for (const run of candidates) {
      if (refsByRun.get(run.id)?.has(p.reference)) {
        coveringRun = run;
        break;
      }
    }

    let runState: PrdRunState = "idle";
    let currentPhase: string | null = null;
    let startedAt: string | null = null;
    let finishedAt: string | null = null;
    let lastEvents: PrdLine["lastEvents"] = [];

    if (coveringRun) {
      const evs =
        eventsByRunByStory.get(coveringRun.id)?.get(p.reference) ?? [];
      const isActive =
        coveringRun.status === "queued" || coveringRun.status === "running";

      if (evs.length === 0) {
        runState = isActive ? "pending" : "idle";
      } else {
        // Replay reduzido pra derivar state + timestamps.
        for (const ev of evs) {
          if (ev.kind === "story_picked") {
            runState = "running";
            startedAt = startedAt ?? ev.ts;
          } else if (ev.kind === "story_done") {
            const ok =
              (ev.payload as { ok?: unknown } | null)?.ok === true;
            runState = ok ? "done" : "failed";
            finishedAt = ev.ts;
          } else if (ev.kind === "story_failed") {
            runState = "failed";
            finishedAt = ev.ts;
          } else if (ev.kind === "error") {
            // erro interno ainda não termina, mas marca phase
          }
          currentPhase = ev.kind;
        }
      }

      // Últimos 5 eventos com summary não vazia (preview do card).
      lastEvents = evs
        .slice(-15)
        .map((ev) => ({
          kind: ev.kind,
          ts: ev.ts,
          summary: summarizePayload(ev.kind, ev.payload),
        }))
        .filter((e) => e.summary.length > 0)
        .slice(-5);
    }

    const durationMs =
      startedAt && finishedAt
        ? new Date(finishedAt).getTime() - new Date(startedAt).getTime()
        : startedAt && runState === "running"
          ? Date.now() - new Date(startedAt).getTime()
          : null;

    return {
      id: p.id,
      reference: p.reference,
      title: p.title,
      status: p.status,
      oneLiner: p.oneLiner ?? "",
      acCount: ac.length,
      updatedAt: p.updatedAt,
      runState,
      runId: coveringRun?.id ?? null,
      currentPhase,
      startedAt,
      finishedAt,
      durationMs,
      lastEvents,
    };
  });

  return NextResponse.json({
    project: { id: project.id, name: project.name },
    sessionId: project.forgeSourceSessionId,
    activeRunId: activeRun?.id ?? null,
    prds,
  });
}
