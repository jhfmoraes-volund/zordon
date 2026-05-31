import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getEffectiveAccessLevel } from "@/lib/dal";
import { hasMinAccessLevel } from "@/lib/roles";

export const dynamic = "force-dynamic";

/**
 * GET /api/forge/runs/[runId]/prd-status
 *
 * Cruza ForgeRun.manifest (snapshot de PRDs) com ForgeEvent (stream do run)
 * pra derivar status por PRD: pending | running | done | failed.
 *
 * Estados derivados de:
 *   story_picked  → running
 *   story_done    → done (se payload.ok=true) ou failed (caso contrário)
 *   story_failed  → failed
 *   (sem nada)    → pending
 *
 * No nosso snapshot atual, cada PRD vira 1 story com id = PRD.reference.
 * Por isso o cruzamento usa `payload.storyId === manifest.prds[i].reference`.
 */

type PrdStatus = "pending" | "running" | "done" | "failed";

type PrdLine = {
  id: string;
  reference: string;
  title: string;
  status: PrdStatus;
  startedAt: string | null;
  finishedAt: string | null;
  durationMs: number | null;
};

type ManifestPrd = {
  id?: string;
  reference?: string;
  title?: string;
};

type EventRow = {
  kind: string;
  ts: string;
  payload: Record<string, unknown> | null;
};

export async function GET(
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
    .select("manifest, status")
    .eq("id", runId)
    .maybeSingle();
  if (runErr) {
    return NextResponse.json({ error: runErr.message }, { status: 500 });
  }
  if (!run) {
    return NextResponse.json({ error: "run_not_found" }, { status: 404 });
  }

  const manifest = run.manifest as { prds?: ManifestPrd[] };
  const manifestPrds: ManifestPrd[] = manifest?.prds ?? [];

  const { data: rawEvents, error: evErr } = await supabase
    .from("ForgeEvent")
    .select("kind, ts, payload")
    .eq("runId", runId)
    .in("kind", ["story_picked", "story_done", "story_failed"])
    .order("seq", { ascending: true });
  if (evErr) {
    return NextResponse.json({ error: evErr.message }, { status: 500 });
  }
  const events = (rawEvents ?? []) as EventRow[];

  // Index events por storyId (= PRD.reference no nosso manifest).
  const byStory = new Map<string, EventRow[]>();
  for (const ev of events) {
    const sid =
      typeof ev.payload?.storyId === "string"
        ? (ev.payload.storyId as string)
        : null;
    if (!sid) continue;
    const list = byStory.get(sid) ?? [];
    list.push(ev);
    byStory.set(sid, list);
  }

  const prds: PrdLine[] = manifestPrds.map((p) => {
    const ref = p.reference ?? "";
    const evs = byStory.get(ref) ?? [];

    let status: PrdStatus = "pending";
    let startedAt: string | null = null;
    let finishedAt: string | null = null;

    for (const ev of evs) {
      if (ev.kind === "story_picked") {
        status = "running";
        startedAt = startedAt ?? ev.ts;
      } else if (ev.kind === "story_done") {
        const ok =
          (ev.payload as { ok?: unknown } | null)?.ok === true;
        status = ok ? "done" : "failed";
        finishedAt = ev.ts;
      } else if (ev.kind === "story_failed") {
        status = "failed";
        finishedAt = ev.ts;
      }
    }

    const durationMs =
      startedAt && finishedAt
        ? new Date(finishedAt).getTime() - new Date(startedAt).getTime()
        : null;

    return {
      id: p.id ?? ref,
      reference: ref,
      title: p.title ?? "(sem título)",
      status,
      startedAt,
      finishedAt,
      durationMs,
    };
  });

  return NextResponse.json({
    runStatus: run.status,
    prds,
  });
}
