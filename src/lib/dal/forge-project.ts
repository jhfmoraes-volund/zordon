import "server-only";
import { db } from "@/lib/db";
import { listPrds, filterPrdsByProject, type PrdSummary } from "@/lib/forge/prd-fs";
import type { Database } from "@/lib/supabase/database.types";

type Tables = Database["public"]["Tables"];
type ForgeRunRow = Tables["ForgeRun"]["Row"];

export type ProjectForgeSummary = {
  prds: PrdSummary[];
  runs: ForgeRunRow[];
  cost7d: number;
  runCount7d: number;
};

/**
 * Get Forge summary for a single project:
 * - PRDs filtered by project slug match
 * - Top 5 ForgeRun for this project (desc by createdAt)
 * - Cost7d: sum of costUsdTotal for runs in last 7 days
 * - RunCount7d: count of runs in last 7 days
 */
export async function getProjectForgeSummary(
  projectId: string,
): Promise<ProjectForgeSummary> {
  // 1. Fetch project to get name for slug matching
  const { data: project, error: projectError } = await db()
    .from("Project")
    .select("name")
    .eq("id", projectId)
    .maybeSingle();

  if (projectError) throw projectError;
  if (!project) {
    throw new Error(`Project ${projectId} not found`);
  }

  // 2. Fetch PRDs (all) and filter by slug match
  const allPrds = await listPrds();
  const prds = filterPrdsByProject(allPrds, project);

  // 3. Fetch runs for this project (top 5, newest first)
  const { data: runs, error: runsError } = await db()
    .from("ForgeRun")
    .select("*")
    .eq("projectId", projectId)
    .order("createdAt", { ascending: false })
    .limit(5);

  if (runsError) throw runsError;

  // 4. Aggregate cost and count for last 7 days
  const now = new Date();
  const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

  const { data: recentRuns, error: recentError } = await db()
    .from("ForgeRun")
    .select("costUsdTotal, createdAt")
    .eq("projectId", projectId)
    .gte("createdAt", sevenDaysAgo.toISOString());

  if (recentError) throw recentError;

  const cost7d = (recentRuns ?? []).reduce(
    (sum, run) => sum + (run.costUsdTotal ?? 0),
    0,
  );
  const runCount7d = (recentRuns ?? []).length;

  return {
    prds,
    runs: runs ?? [],
    cost7d,
    runCount7d,
  };
}
