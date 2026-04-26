import "server-only";
import { db } from "@/lib/db";
import type { Json } from "@/lib/supabase/database.types";

type RecordArgs = {
  agentName: string;
  threadId: string | null;
  memberId: string | null | undefined;
  modelId: string;
  /** AI SDK usage object (v6: inputTokens, outputTokens, totalTokens, ...). */
  usage: unknown;
  /** providerMetadata returned alongside the stream finish. */
  providerMetadata: unknown;
  /** OpenRouter generation id from event.response.id — used to look up details via /generation. */
  generationId: string | null;
};

type AISdkUsage = {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  cachedInputTokens?: number;
  reasoningTokens?: number;
};

type OpenRouterUsage = {
  cost?: number;
  totalTokens?: number;
  promptTokens?: number;
  completionTokens?: number;
};

/**
 * Persists one row in AgentUsage from the data emitted by streamText's onFinish.
 * Failures are swallowed (logged) — usage tracking never blocks the response.
 */
export async function recordAgentUsage(args: RecordArgs): Promise<void> {
  try {
    const sdkUsage = (args.usage ?? {}) as AISdkUsage;
    const meta = (args.providerMetadata ?? {}) as Record<string, unknown>;
    const orMeta = (meta.openrouter ?? {}) as Record<string, unknown>;
    const orUsage = (orMeta.usage ?? {}) as OpenRouterUsage;

    const promptTokens = sdkUsage.inputTokens ?? orUsage.promptTokens ?? 0;
    const completionTokens = sdkUsage.outputTokens ?? orUsage.completionTokens ?? 0;
    const totalTokens =
      sdkUsage.totalTokens ?? orUsage.totalTokens ?? promptTokens + completionTokens;

    const cost = typeof orUsage.cost === "number" ? orUsage.cost : 0;

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
        cachedPromptTokens: sdkUsage.cachedInputTokens ?? null,
        reasoningTokens: sdkUsage.reasoningTokens ?? null,
        costUsd: cost,
        generationId: args.generationId,
        rawUsage: {
          sdk: sdkUsage as unknown as Json,
          openrouter: orUsage as unknown as Json,
        } as unknown as Json,
      });

    if (error) {
      console.error("[recordAgentUsage] insert failed:", error.message);
    }
  } catch (err) {
    console.error("[recordAgentUsage] unexpected error:", err);
  }
}
