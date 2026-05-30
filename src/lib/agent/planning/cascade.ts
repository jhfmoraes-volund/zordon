import "server-only";
import { db } from "@/lib/db";
import { buildCodebaseIndex } from "./codebase-index";
import { buildPrdIndex } from "./prd-index";
import { callCodebaseAuditor } from "./subagents/codebase-auditor";
import { callDependencyResolver } from "./subagents/dep-resolver";
import { callStoryDecomposer } from "./subagents/story-decomposer";
import { callCapacityAllocator } from "./subagents/capacity";
import { callVitoriaConsolidator } from "./subagents/consolidator";
import { updateStatus, getSession } from "@/lib/dal/planning-session";

const COST_CAP_USD = 3.0;

/**
 * Pre-flight cost estimation
 * Rough estimate based on token counts
 */
function estimateCost(version: TargetVersion): number {
  // v1: ~0.30 USD (Stage 0/1A/1B/2/5/6/7)
  // v2: ~0.80 USD (+ Stage 3)
  // v3: ~1.50 USD (+ Stage 4)
  const estimates = {
    v1: 0.3,
    v2: 0.8,
    v3: 1.5,
  };
  return estimates[version];
}

export type TargetVersion = "v1" | "v2" | "v3";

export type CascadeStageResult = {
  stage: string;
  durationMs: number;
  tokensUsed?: number;
  costUsd?: number;
  output: unknown;
};

export type CascadeResult = {
  sessionId: string;
  success: boolean;
  version: TargetVersion;
  stages: CascadeStageResult[];
  totalDurationMs: number;
  totalTokensUsed: number;
  totalCostUsd: number;
  error?: string;
};

/**
 * runCascade orchestrator — executes the planning cascade for a PlanningSession
 *
 * @param sessionId - The PlanningSession ID
 * @param targetVersion - The version to run (v1/v2/v3)
 * @returns CascadeResult with all stages executed
 *
 * Stages:
 * - Stage 0: Build indexes (codebase + PRDs)
 * - Stage 1A+1B: CodebaseAuditor + DependencyResolver (parallel)
 * - Stage 2: StoryDecomposer
 * - Stage 3 (v2+): TaskGen (NOT implemented in this story — see PLAN-011)
 * - Stage 4 (v3): SDDPolish (NOT implemented in this story — see PLAN-014)
 * - Stage 5: (reserved for future use)
 * - Stage 6: CapacityAllocator
 * - Stage 7: VitoriaConsolidator
 *
 * Cost cap: $3.00 USD pre-flight check
 * State persistence: agentOutputsJsonb updated after each stage
 */
export async function runCascade(
  sessionId: string,
  targetVersion: TargetVersion = "v1"
): Promise<CascadeResult> {
  const t0 = Date.now();
  const stages: CascadeStageResult[] = [];
  let totalTokensUsed = 0;
  let totalCostUsd = 0;

  const result: CascadeResult = {
    sessionId,
    success: false,
    version: targetVersion,
    stages,
    totalDurationMs: 0,
    totalTokensUsed: 0,
    totalCostUsd: 0,
  };

  try {
    // Pre-flight cost check
    const estimatedCost = estimateCost(targetVersion);
    if (estimatedCost > COST_CAP_USD) {
      throw new Error(
        `Estimated cost ${estimatedCost.toFixed(2)} USD exceeds cap of ${COST_CAP_USD.toFixed(2)} USD`
      );
    }

    // Update status to orchestrating
    await updateStatus(sessionId, "orchestrating");

    // Get session to load context
    const session = await getSession(sessionId);
    if (!session) {
      throw new Error(`PlanningSession ${sessionId} not found`);
    }

    // ─── Stage 0: Build Indexes ───────────────────────────────────────
    const stage0t0 = Date.now();
    const codebaseIndex = await buildCodebaseIndex(
      process.cwd() // repoRoot = current working directory
    );
    const prdIndex = await buildPrdIndex();

    const stage0 = {
      stage: "0-indexes",
      durationMs: Date.now() - stage0t0,
      output: {
        codebaseIndex: {
          files: codebaseIndex.files.length,
          dbTables: codebaseIndex.dbTables.length,
          apiRoutes: codebaseIndex.apiRoutes.length,
        },
        prdIndex: {
          prds: prdIndex.length,
        },
      },
    };
    stages.push(stage0);

    // Persist codebase + prd SHA to PlanningSession
    // Note: SHA is computed internally by buildCodebaseIndex for caching
    await db()
      .from("PlanningSession")
      .update({
        codebaseIndexSha: "computed", // buildCodebaseIndex caches by git SHA internally
        prdIndexSha: prdIndex.length > 0 ? "computed" : null, // prd-index uses concat SHA
        agentOutputsJsonb: { stage0: stage0.output },
      })
      .eq("id", sessionId);

    // ─── Stage 1A + 1B: Parallel Auditor + Dependency Resolver ────────
    const stage1t0 = Date.now();
    const [auditorResult, depResolverResult] = await Promise.all([
      callCodebaseAuditor(prdIndex, codebaseIndex),
      callDependencyResolver(prdIndex),
    ]);

    const stage1A = {
      stage: "1A-auditor",
      durationMs: Date.now() - stage1t0,
      tokensUsed: auditorResult.usage?.totalTokens ?? 0,
      costUsd: auditorResult.usage?.cost ?? 0,
      output: auditorResult.parsed,
    };
    const stage1B = {
      stage: "1B-dep-resolver",
      durationMs: Date.now() - stage1t0,
      tokensUsed: depResolverResult.usage?.totalTokens ?? 0,
      costUsd: depResolverResult.usage?.cost ?? 0,
      output: depResolverResult.parsed,
    };
    stages.push(stage1A, stage1B);

    totalTokensUsed += stage1A.tokensUsed! + stage1B.tokensUsed!;
    totalCostUsd += stage1A.costUsd! + stage1B.costUsd!;

    // Persist outputs
    await db()
      .from("PlanningSession")
      .update({
        agentOutputsJsonb: {
          stage0: stage0.output,
          stage1A: stage1A.output,
          stage1B: stage1B.output,
        },
        tokensUsed: totalTokensUsed,
        costUsd: totalCostUsd,
      })
      .eq("id", sessionId);

    // ─── Stage 2: StoryDecomposer ─────────────────────────────────────
    const stage2t0 = Date.now();
    const storyDecomposerResult = await callStoryDecomposer(
      prdIndex,
      auditorResult.parsed
    );

    const stage2 = {
      stage: "2-story-decomposer",
      durationMs: Date.now() - stage2t0,
      tokensUsed: storyDecomposerResult.usage?.totalTokens ?? 0,
      costUsd: storyDecomposerResult.usage?.cost ?? 0,
      output: storyDecomposerResult.parsed,
    };
    stages.push(stage2);

    totalTokensUsed += stage2.tokensUsed!;
    totalCostUsd += stage2.costUsd!;

    // Persist outputs
    await db()
      .from("PlanningSession")
      .update({
        agentOutputsJsonb: {
          stage0: stage0.output,
          stage1A: stage1A.output,
          stage1B: stage1B.output,
          stage2: stage2.output,
        },
        tokensUsed: totalTokensUsed,
        costUsd: totalCostUsd,
      })
      .eq("id", sessionId);

    // ─── Stage 3 (v2+): TaskGen ───────────────────────────────────────
    // NOT implemented in this story (PLAN-007)
    // See PLAN-011 for implementation
    // if (targetVersion === "v2" || targetVersion === "v3") {
    //   // callTaskGen per US in parallel
    // }

    // ─── Stage 4 (v3): SDDPolish ──────────────────────────────────────
    // NOT implemented in this story (PLAN-007)
    // See PLAN-014 for implementation
    // if (targetVersion === "v3") {
    //   // callSDDPolish per Task in parallel
    // }

    // ─── Stage 5: Reserved for future use ─────────────────────────────
    // Placeholder for potential future stage (e.g., TaskGraphResolver)

    // ─── Stage 6: CapacityAllocator ───────────────────────────────────
    const stage6t0 = Date.now();
    const capacityResult = await callCapacityAllocator(
      prdIndex,
      depResolverResult.parsed,
      session.sprintCount ?? 6
    );

    const stage6 = {
      stage: "6-capacity",
      durationMs: Date.now() - stage6t0,
      tokensUsed: capacityResult.usage?.totalTokens ?? 0,
      costUsd: capacityResult.usage?.cost ?? 0,
      output: capacityResult.parsed,
    };
    stages.push(stage6);

    totalTokensUsed += stage6.tokensUsed!;
    totalCostUsd += stage6.costUsd!;

    // Persist outputs
    await db()
      .from("PlanningSession")
      .update({
        agentOutputsJsonb: {
          stage0: stage0.output,
          stage1A: stage1A.output,
          stage1B: stage1B.output,
          stage2: stage2.output,
          stage6: stage6.output,
        },
        tokensUsed: totalTokensUsed,
        costUsd: totalCostUsd,
      })
      .eq("id", sessionId);

    // ─── Stage 7: VitoriaConsolidator ─────────────────────────────────
    const stage7t0 = Date.now();
    const consolidatorResult = await callVitoriaConsolidator(
      prdIndex,
      auditorResult.parsed,
      depResolverResult.parsed,
      storyDecomposerResult.parsed,
      capacityResult.parsed
    );

    const stage7 = {
      stage: "7-consolidator",
      durationMs: Date.now() - stage7t0,
      tokensUsed: consolidatorResult.usage?.totalTokens ?? 0,
      costUsd: consolidatorResult.usage?.cost ?? 0,
      output: consolidatorResult.parsed,
    };
    stages.push(stage7);

    totalTokensUsed += stage7.tokensUsed!;
    totalCostUsd += stage7.costUsd!;

    // ─── Finalize: Persist draftRoadmap + update status ───────────────
    await db()
      .from("PlanningSession")
      .update({
        agentOutputsJsonb: {
          stage0: stage0.output,
          stage1A: stage1A.output,
          stage1B: stage1B.output,
          stage2: stage2.output,
          stage6: stage6.output,
          stage7: stage7.output,
        },
        draftRoadmapJsonb: consolidatorResult.parsed.draftRoadmap,
        tokensUsed: totalTokensUsed,
        costUsd: totalCostUsd,
        status: "in-review",
      })
      .eq("id", sessionId);

    // Create PlanningSessionPRD rows from draftRoadmap
    const prdsToInsert = consolidatorResult.parsed.draftRoadmap.prds.map(
      (prd) => ({
        planningSessionId: sessionId,
        prdSlug: prd.prdSlug,
        sprintStart: prd.sprintStart,
        sprintCount: prd.sprintCount,
        order: prd.order,
        agentJustification: prd.justification,
      })
    );

    if (prdsToInsert.length > 0) {
      await db().from("PlanningSessionPRD").insert(prdsToInsert);
    }

    result.success = true;
    result.totalDurationMs = Date.now() - t0;
    result.totalTokensUsed = totalTokensUsed;
    result.totalCostUsd = totalCostUsd;

    return result;
  } catch (e) {
    const errorMessage =
      e instanceof Error ? e.message : String(e);

    // Update status to error
    await updateStatus(sessionId, "error", { errorMessage });

    result.success = false;
    result.error = errorMessage;
    result.totalDurationMs = Date.now() - t0;
    result.totalTokensUsed = totalTokensUsed;
    result.totalCostUsd = totalCostUsd;

    return result;
  }
}
