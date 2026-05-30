import "server-only";
import { z } from "zod";
import { callOpenRouterJson } from "@/lib/insights/llm";
import type { PrdIndexEntry } from "../prd-index";

/**
 * Dependency Resolver Output Schema
 *
 * Analyzes PRD dependencies and generates a valid DAG execution order.
 */
export const dagOutputSchema = z.object({
  executionOrder: z.array(
    z.object({
      prdSlug: z.string().min(1),
      phase: z.number().int().min(1),
      blockedBy: z.array(z.string()),
      reasoning: z.string().min(1),
    })
  ),
  parallelizable: z.array(
    z.object({
      phase: z.number().int().min(1),
      prds: z.array(z.string()),
    })
  ),
  criticalPath: z.array(z.string()),
  cycles: z.array(
    z.object({
      prds: z.array(z.string()),
      resolution: z.string().min(1),
    })
  ),
  estimatedTotalMinutes: z.number().int().min(0),
  summary: z.string().min(1),
});

export type DAGOutput = z.infer<typeof dagOutputSchema>;

const MODEL = "anthropic/claude-haiku-4-5";

/**
 * Calls the Dependency Resolver subagent via OpenRouter (Haiku).
 *
 * Analyzes PRD dependencies to generate a valid DAG execution order,
 * identify parallel opportunities, and detect cycles.
 */
export async function callDependencyResolver(
  prdIndex: PrdIndexEntry[]
): Promise<DAGOutput> {
  const systemPrompt = buildSystemPrompt();
  const userPrompt = buildUserPrompt(prdIndex);

  const result = await callOpenRouterJson({
    model: MODEL,
    systemPrompt,
    userPrompt,
  });

  const parsed = dagOutputSchema.safeParse(result.parsed);
  if (!parsed.success) {
    throw new Error(
      `DAG output validation failed: ${parsed.error.issues[0]?.message}`
    );
  }

  return parsed.data;
}

function buildSystemPrompt(): string {
  return `You are a dependency resolver for PRD execution planning.

Your role is to:
1. Analyze PRD dependencies and generate a valid DAG execution order
2. Identify which PRDs can be executed in parallel
3. Detect dependency cycles and suggest resolutions
4. Calculate the critical path

You must return valid JSON matching this schema:

{
  "executionOrder": [
    {
      "prdSlug": "prd-slug",
      "phase": 1,
      "blockedBy": ["prd-slug-a", "prd-slug-b"],
      "reasoning": "why this phase/order"
    }
  ],
  "parallelizable": [
    {
      "phase": 1,
      "prds": ["prd-a", "prd-b", "prd-c"]
    }
  ],
  "criticalPath": ["prd-a", "prd-b", "prd-c"],
  "cycles": [
    {
      "prds": ["prd-x", "prd-y"],
      "resolution": "how to break the cycle"
    }
  ],
  "estimatedTotalMinutes": 1200,
  "summary": "2-3 sentence overview of execution plan"
}

Phase numbers start at 1. Phase N can only execute after all PRDs in phases 1..N-1 are complete.
Critical path is the longest dependency chain.`;
}

function buildUserPrompt(prdIndex: PrdIndexEntry[]): string {
  const prdDetails = prdIndex
    .map(
      (prd) =>
        `- ${prd.slug}:
    Title: ${prd.title}
    Estimate: ${prd.estimateMinutesTotal} minutes
    Depends on: ${prd.dependsOn.length > 0 ? prd.dependsOn.join(", ") : "none"}
    Risk: ${prd.riskLevel}`
    )
    .join("\n");

  return `Analyze these PRDs and generate a valid execution DAG:

${prdDetails}

Generate:
1. Execution order with phase assignments
2. Which PRDs can run in parallel (same phase)
3. Critical path (longest dependency chain)
4. Any dependency cycles and how to resolve them

Return valid JSON matching the schema.`;
}
