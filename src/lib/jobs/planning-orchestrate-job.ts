import "server-only";
import { runCascade, type TargetVersion, type CascadeResult } from "@/lib/agent/planning/cascade";

export type PlanningOrchestratJobInput = {
  sessionId: string;
  targetVersion?: TargetVersion;
};

export type PlanningOrchestrateJobResult = {
  sessionId: string;
  success: boolean;
  version: TargetVersion;
  totalDurationMs: number;
  totalTokensUsed: number;
  totalCostUsd: number;
  error?: string;
};

/**
 * Job worker that runs the planning cascade
 *
 * This is intended to be called from an API endpoint that creates a job
 * and invokes this worker asynchronously. The worker runs runCascade and
 * returns the result.
 *
 * Pattern follows the InsightJob worker in src/lib/insights/run-job.ts
 */
export async function runPlanningOrchestrateJob(
  input: PlanningOrchestratJobInput
): Promise<PlanningOrchestrateJobResult> {
  const { sessionId, targetVersion = "v1" } = input;

  const result: CascadeResult = await runCascade(sessionId, targetVersion);

  return {
    sessionId: result.sessionId,
    success: result.success,
    version: result.version,
    totalDurationMs: result.totalDurationMs,
    totalTokensUsed: result.totalTokensUsed,
    totalCostUsd: result.totalCostUsd,
    error: result.error,
  };
}
