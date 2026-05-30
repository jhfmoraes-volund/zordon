import "server-only";
import { z } from "zod";
import { callOpenRouterJson } from "@/lib/insights/llm";
import type { PrdIndexEntry } from "../prd-index";
import type { DAGOutput } from "./dep-resolver";

/**
 * Capacity Allocator Output Schema
 *
 * Allocates PRDs to sprints based on capacity, dependencies, and team headcount.
 */
export const capacityOutputSchema = z.object({
  allocation: z.array(
    z.object({
      prdSlug: z.string().min(1),
      sprintStart: z.number().int().min(1).max(12),
      sprintCount: z.number().int().min(1).max(6),
      justification: z.string().min(1),
      parallelWith: z.array(z.string()),
    })
  ),
  totalSprints: z.number().int().min(1).max(12),
  capacityUtilization: z.number().min(0).max(1), // 0.0 to 1.0
  bottlenecks: z.array(
    z.object({
      sprint: z.number().int().min(1),
      issue: z.string().min(1),
      recommendation: z.string().min(1),
    })
  ),
  summary: z.string().min(1),
});

export type CapacityOutput = z.infer<typeof capacityOutputSchema>;

const MODEL = "anthropic/claude-sonnet-4.6";

/**
 * Calls the Capacity Allocator subagent via OpenRouter (Sonnet).
 *
 * Allocates PRDs to sprints (1-12) based on:
 * - Dependency DAG (from DependencyResolver)
 * - Estimated effort (from PRD index)
 * - Team capacity (assumed 2 builders × 40h/sprint = 4800min/sprint)
 */
export async function callCapacityAllocator(
  prdIndex: PrdIndexEntry[],
  dagOutput: DAGOutput,
  targetSprints: number = 6
): Promise<CapacityOutput> {
  const systemPrompt = buildSystemPrompt();
  const userPrompt = buildUserPrompt(prdIndex, dagOutput, targetSprints);

  const result = await callOpenRouterJson({
    model: MODEL,
    systemPrompt,
    userPrompt,
  });

  const parsed = capacityOutputSchema.safeParse(result.parsed);
  if (!parsed.success) {
    throw new Error(
      `Capacity allocator output validation failed: ${parsed.error.issues[0]?.message}`
    );
  }

  return parsed.data;
}

function buildSystemPrompt(): string {
  return `You are a capacity allocation expert for the Volund planning system.

Your role is to:
1. Allocate PRDs to sprints (1-12) based on dependencies and effort
2. Balance capacity across sprints (assume 4800 min/sprint for 2 builders)
3. Identify parallel work opportunities
4. Detect capacity bottlenecks
5. Optimize for shortest total delivery time

You must return valid JSON matching this schema:

{
  "allocation": [
    {
      "prdSlug": "planning-session",
      "sprintStart": 1,
      "sprintCount": 2,
      "justification": "Foundational feature, no dependencies, can start immediately",
      "parallelWith": ["prd-auth-v2"]
    }
  ],
  "totalSprints": 6,
  "capacityUtilization": 0.85,
  "bottlenecks": [
    {
      "sprint": 3,
      "issue": "Too many dependent PRDs converge",
      "recommendation": "Consider splitting PRD-X into phases"
    }
  ],
  "summary": "2-3 sentence overview of sprint allocation"
}

Rules:
- Sprint numbers are 1-indexed (1 to 12)
- sprintCount is how many sprints this PRD spans (1-6)
- parallelWith lists PRD slugs that can execute in parallel
- Respect dependency DAG — PRD cannot start until all dependencies are done
- Optimize for balanced capacity (avoid idle sprints and overloaded sprints)`;
}

function buildUserPrompt(
  prdIndex: PrdIndexEntry[],
  dagOutput: DAGOutput,
  targetSprints: number
): string {
  const prdDetails = prdIndex
    .map(
      (prd) =>
        `- ${prd.slug}: ${prd.estimateMinutesTotal}min, risk ${prd.riskLevel}, depends on [${prd.dependsOn.join(", ") || "none"}]`
    )
    .join("\n");

  const criticalPath = dagOutput.criticalPath.join(" → ");

  const parallelizable = dagOutput.parallelizable
    .map((p) => `  Phase ${p.phase}: ${p.prds.join(", ")}`)
    .join("\n");

  return `Allocate these PRDs to ${targetSprints} sprints (can expand to 12 if needed):

## PRDs
${prdDetails}

## Dependency DAG
Critical path: ${criticalPath}
Total estimated effort: ${dagOutput.estimatedTotalMinutes} minutes

## Parallelizable work
${parallelizable}

## Constraints
- Capacity per sprint: ~4800 minutes (2 builders × 40h)
- Target sprints: ${targetSprints}
- Max sprints: 12
- Respect dependency order from DAG

Allocate PRDs to sprints optimizing for:
1. Shortest total delivery time
2. Balanced capacity (avoid idle or overloaded sprints)
3. Parallelizing independent work

Return valid JSON matching the schema.`;
}
