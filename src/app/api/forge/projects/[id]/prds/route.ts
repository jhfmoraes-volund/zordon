import { NextResponse } from "next/server";
import { getEffectiveAccessLevel } from "@/lib/dal";
import { hasMinAccessLevel } from "@/lib/roles";
import { db } from "@/lib/db";
import { getPrdsForSession } from "@/lib/dal/product-requirements";
import { derivePrdRunInfo } from "@/lib/dal/forge-project";
import type { PrdRunState } from "@/lib/forge/run-state";

export const dynamic = "force-dynamic";

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

  // Run ativo do projeto (pra o HUD): queued ou running, mais recente.
  const { data: activeRuns } = await supabase
    .from("ForgeRun")
    .select("id")
    .eq("projectId", projectId)
    .in("status", ["queued", "running"])
    .order("createdAt", { ascending: false })
    .limit(1);
  const activeRunId = activeRuns?.[0]?.id ?? null;

  // Run-state por PRD — derivação compartilhada com getProjectForgeSummary.
  const runInfo = await derivePrdRunInfo(
    supabase,
    projectId,
    rows.map((r) => r.reference),
  );

  const prds: PrdLine[] = rows.map((p) => {
    const ac = Array.isArray(p.acceptanceCriteria)
      ? (p.acceptanceCriteria as unknown[])
      : [];
    const info = runInfo.get(p.reference);
    return {
      id: p.id,
      reference: p.reference,
      title: p.title,
      status: p.status,
      oneLiner: p.oneLiner ?? "",
      acCount: ac.length,
      updatedAt: p.updatedAt,
      runState: info?.runState ?? "idle",
      runId: info?.runId ?? null,
      currentPhase: info?.currentPhase ?? null,
      startedAt: info?.startedAt ?? null,
      finishedAt: info?.finishedAt ?? null,
      durationMs: info?.durationMs ?? null,
      lastEvents: info?.lastEvents ?? [],
    };
  });

  return NextResponse.json({
    project: { id: project.id, name: project.name },
    sessionId: project.forgeSourceSessionId,
    activeRunId,
    prds,
  });
}
