import "server-only";
import { db } from "@/lib/db";
import type { Json } from "@/lib/supabase/database.types";

type RecordArgs = {
  agentName: string;
  threadId: string | null;
  memberId: string | null | undefined;
  modelId: string;
  /** Aggregated usage from `event.totalUsage` (sum of all steps). */
  totalUsage: unknown;
  /** All steps in the run. Each step has its own `providerMetadata`. */
  steps: ReadonlyArray<{
    usage?: unknown;
    providerMetadata?: unknown;
  }>;
  /** OpenRouter generation id from event.response.id — used to look up details via /generation. */
  generationId: string | null;
};

type LMUsage = {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  cachedInputTokens?: number;
  reasoningTokens?: number;
  inputTokenDetails?: {
    noCacheTokens?: number;
    cacheReadTokens?: number;
    cacheWriteTokens?: number;
  };
};

type OpenRouterUsage = {
  cost?: number;
  totalTokens?: number;
  promptTokens?: number;
  completionTokens?: number;
  promptTokensDetails?: { cachedTokens?: number };
  cache_creation_input_tokens?: number;
  cache_read_input_tokens?: number;
};

function getOrUsage(providerMetadata: unknown): OpenRouterUsage {
  const meta = (providerMetadata ?? {}) as Record<string, unknown>;
  const orMeta = (meta.openrouter ?? {}) as Record<string, unknown>;
  return (orMeta.usage ?? {}) as OpenRouterUsage;
}

/**
 * Persists one row in AgentUsage from the data emitted by streamText's onFinish.
 *
 * Critical: when the agent makes tool calls, the SDK runs N model calls
 * ("steps") within a single turn. The bug we're fixing: previously we
 * persisted only the LAST step's usage/cost, undercounting by Nx the real
 * cost. The fix sums `cost` across all steps' providerMetadata and uses
 * `totalUsage` (which the SDK aggregates).
 *
 * Failures are swallowed (logged) — usage tracking never blocks the response.
 */
export async function recordAgentUsage(args: RecordArgs): Promise<void> {
  try {
    const totalUsage = (args.totalUsage ?? {}) as LMUsage;

    const promptTokens = totalUsage.inputTokens ?? 0;
    const completionTokens = totalUsage.outputTokens ?? 0;
    const totalTokens =
      totalUsage.totalTokens ?? promptTokens + completionTokens;

    // Sum cost across all steps. Each step has its own OpenRouter usage with
    // a `cost` value already in USD (cache discounts already applied upstream).
    let totalCost = 0;
    const stepBreakdown: Array<{
      stepNumber: number;
      cost: number;
      promptTokens: number;
      completionTokens: number;
      cacheReadTokens: number;
      cacheWriteTokens: number;
    }> = [];

    args.steps.forEach((step, idx) => {
      const orUsage = getOrUsage(step.providerMetadata);
      const stepCost = typeof orUsage.cost === "number" ? orUsage.cost : 0;
      totalCost += stepCost;

      const stepUsage = (step.usage ?? {}) as LMUsage;
      stepBreakdown.push({
        stepNumber: idx,
        cost: stepCost,
        promptTokens: stepUsage.inputTokens ?? 0,
        completionTokens: stepUsage.outputTokens ?? 0,
        cacheReadTokens: stepUsage.inputTokenDetails?.cacheReadTokens ?? 0,
        cacheWriteTokens: stepUsage.inputTokenDetails?.cacheWriteTokens ?? 0,
      });
    });

    const { error } = await db()
      .from("AgentUsage")
      .insert({
        threadId: args.threadId,
        agentName: args.agentName,
        memberId: args.memberId ?? null,
        modelId: args.modelId,
        promptTokens,
        completionTokens,
        totalTokens,
        cachedPromptTokens: totalUsage.cachedInputTokens ?? null,
        reasoningTokens: totalUsage.reasoningTokens ?? null,
        costUsd: totalCost,
        generationId: args.generationId,
        rawUsage: {
          totalUsage: totalUsage as unknown as Json,
          stepCount: args.steps.length,
          steps: stepBreakdown as unknown as Json,
        } as unknown as Json,
      });

    if (error) {
      console.error("[recordAgentUsage] insert failed:", error.message);
    }
  } catch (err) {
    console.error("[recordAgentUsage] unexpected error:", err);
  }
}
