import "server-only";
import { z } from "zod";
import { callOpenRouterJson } from "@/lib/insights/llm";
import type { PrdIndexEntry } from "../prd-index";
import type { AuditorOutput } from "./codebase-auditor";
import type { DAGOutput } from "./dep-resolver";
import type { StoryDecomposerOutput } from "./story-decomposer";
import type { CapacityOutput } from "./capacity";

/**
 * Vitoria Consolidator Output Schema
 *
 * STRICT consolidator — does NOT opine, only orders and validates outputs
 * from upstream subagents. Vitoria is the orchestrator, not the decision-maker.
 */
export const consolidatorOutputSchema = z.object({
  draftRoadmap: z.object({
    prds: z.array(
      z.object({
        prdSlug: z.string().min(1),
        sprintStart: z.number().int().min(1).max(12),
        sprintCount: z.number().int().min(1).max(6),
        order: z.number().int().min(0), // within sprint
        justification: z.string().min(1),
      })
    ),
    totalSprints: z.number().int().min(1).max(12),
  }),
  warnings: z.array(
    z.object({
      type: z.enum(["conflict", "capacity", "dependency", "other"]),
      message: z.string().min(1),
      severity: z.enum(["low", "medium", "high"]),
    })
  ),
  summary: z.string().min(1),
});

export type ConsolidatorOutput = z.infer<typeof consolidatorOutputSchema>;

const MODEL = "anthropic/claude-sonnet-4.6";

/**
 * Calls the Vitoria Consolidator subagent via OpenRouter (Sonnet).
 *
 * **Vitoria is STRICT** — she does NOT opine or add her own reasoning.
 * She consolidates outputs from upstream subagents, validates consistency,
 * and produces the final draftRoadmap with warnings.
 */
export async function callVitoriaConsolidator(
  prdIndex: PrdIndexEntry[],
  auditorOutput: AuditorOutput,
  dagOutput: DAGOutput,
  storyOutput: StoryDecomposerOutput,
  capacityOutput: CapacityOutput
): Promise<ConsolidatorOutput> {
  const systemPrompt = buildSystemPrompt();
  const userPrompt = buildUserPrompt(
    prdIndex,
    auditorOutput,
    dagOutput,
    storyOutput,
    capacityOutput
  );

  const result = await callOpenRouterJson({
    model: MODEL,
    systemPrompt,
    userPrompt,
  });

  const parsed = consolidatorOutputSchema.safeParse(result.parsed);
  if (!parsed.success) {
    throw new Error(
      `Consolidator output validation failed: ${parsed.error.issues[0]?.message}`
    );
  }

  return parsed.data;
}

function buildSystemPrompt(): string {
  return `You are Vitoria, the STRICT consolidator for the Volund planning system.

Your role is to:
1. Consolidate outputs from upstream subagents (Auditor, DAG, Stories, Capacity)
2. Validate consistency across all outputs
3. Produce the final draftRoadmap with PRD → sprint allocation
4. Flag warnings for the human owner to review

**CRITICAL RULE: You are STRICT. You do NOT add opinion or reasoning.**
- Use the justifications from upstream subagents verbatim
- Do NOT rewrite or embellish their reasoning
- Do NOT introduce new priorities or decisions
- Your job is to ORDER and VALIDATE, not to OPINE

You must return valid JSON matching this schema:

{
  "draftRoadmap": {
    "prds": [
      {
        "prdSlug": "planning-session",
        "sprintStart": 1,
        "sprintCount": 2,
        "order": 0,
        "justification": "<verbatim from CapacityAllocator>"
      }
    ],
    "totalSprints": 6
  },
  "warnings": [
    {
      "type": "conflict",
      "message": "PRD-X conflicts with existing module Y (from Auditor)",
      "severity": "medium"
    }
  ],
  "summary": "2-3 sentence overview — neutral, factual, no opinion"
}

Validate:
- All PRDs from prdIndex are allocated
- sprintStart + sprintCount - 1 <= totalSprints
- Dependencies from DAG are respected
- Conflicts from Auditor are flagged as warnings
- Stories from Decomposer are consistent with PRDs

Be deterministic. Same inputs → same output.`;
}

function buildUserPrompt(
  prdIndex: PrdIndexEntry[],
  auditorOutput: AuditorOutput,
  dagOutput: DAGOutput,
  storyOutput: StoryDecomposerOutput,
  capacityOutput: CapacityOutput
): string {
  const prdSlugs = prdIndex.map((p) => p.slug).join(", ");

  const allocation = capacityOutput.allocation
    .map(
      (a) =>
        `  ${a.prdSlug}: sprint ${a.sprintStart}-${a.sprintStart + a.sprintCount - 1}, parallel with [${a.parallelWith.join(", ") || "none"}]`
    )
    .join("\n");

  const conflicts = auditorOutput.conflicts
    .map((c) => `  - ${c.prdSlug}: ${c.conflict} (${c.severity})`)
    .join("\n");

  const storiesCount = storyOutput.stories.length;

  return `Consolidate these outputs into the final draftRoadmap:

## PRD Index
PRDs: ${prdSlugs}

## Auditor Findings
Conflicts:
${conflicts || "  (none)"}

## Dependency DAG
Critical path: ${dagOutput.criticalPath.join(" → ")}
Estimated total: ${dagOutput.estimatedTotalMinutes} min

## Story Decomposer
Total stories extracted: ${storiesCount}

## Capacity Allocation
${allocation}

Total sprints: ${capacityOutput.totalSprints}
Capacity utilization: ${(capacityOutput.capacityUtilization * 100).toFixed(0)}%

## Task

Produce the final draftRoadmap:
1. Use Capacity Allocator's allocation as the base
2. Add \`order\` field (0-indexed within each sprint) based on dependency DAG
3. Use Capacity Allocator's justification verbatim (do NOT rewrite)
4. Flag warnings for:
   - Conflicts from Auditor
   - Capacity bottlenecks from Capacity Allocator
   - Dependency violations (if any)

Return valid JSON matching the schema.

**Remember: You are STRICT. No opinion. Just consolidation + validation.**`;
}
