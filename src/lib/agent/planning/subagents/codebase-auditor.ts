import "server-only";
import { z } from "zod";
import { callOpenRouterJson } from "@/lib/insights/llm";
import type { CodebaseIndex } from "../codebase-index";
import type { PrdIndexEntry } from "../prd-index";

/**
 * Codebase Auditor Output Schema
 *
 * Analyzes the codebase index + PRD index to identify:
 * - Existing patterns to reuse
 * - Conflicts with planned PRDs
 * - Architecture recommendations
 */
export const auditorOutputSchema = z.object({
  reusablePatterns: z.array(
    z.object({
      pattern: z.string().min(1),
      location: z.string().min(1),
      applicableTo: z.array(z.string()), // PRD slugs
      recommendation: z.string().min(1),
    })
  ),
  conflicts: z.array(
    z.object({
      prdSlug: z.string().min(1),
      conflict: z.string().min(1),
      severity: z.enum(["low", "medium", "high"]),
      mitigation: z.string().min(1),
    })
  ),
  architectureRecommendations: z.array(
    z.object({
      area: z.string().min(1),
      recommendation: z.string().min(1),
      rationale: z.string().min(1),
    })
  ),
  estimatedComplexity: z.enum(["low", "medium", "high"]),
  summary: z.string().min(1),
});

export type AuditorOutput = z.infer<typeof auditorOutputSchema>;

const MODEL = "anthropic/claude-sonnet-4.6";

/**
 * Calls the Codebase Auditor subagent via OpenRouter.
 *
 * Analyzes codebase index + PRD index to identify reusable patterns,
 * conflicts, and architecture recommendations.
 */
export async function callCodebaseAuditor(
  prdIndex: PrdIndexEntry[],
  codebaseIndex: CodebaseIndex
) {
  const systemPrompt = buildSystemPrompt();
  const userPrompt = buildUserPrompt(prdIndex, codebaseIndex);

  const result = await callOpenRouterJson({
    model: MODEL,
    systemPrompt,
    userPrompt,
  });

  const parsed = auditorOutputSchema.safeParse(result.parsed);
  if (!parsed.success) {
    throw new Error(
      `Auditor output validation failed: ${parsed.error.issues[0]?.message}`
    );
  }

  return {
    parsed: parsed.data,
    usage: {
      totalTokens: (result.usage.prompt_tokens ?? 0) + (result.usage.completion_tokens ?? 0),
      cost: result.usage.cost ?? 0,
    },
  };
}

function buildSystemPrompt(): string {
  return `You are a codebase auditor for the Volund planning system.

Your role is to analyze the existing codebase structure and planned PRDs to:
1. Identify reusable patterns, components, and utilities
2. Detect conflicts or overlaps between planned PRDs and existing code
3. Provide architecture recommendations

You must return valid JSON matching this schema:

{
  "reusablePatterns": [
    {
      "pattern": "pattern name",
      "location": "file path or module",
      "applicableTo": ["prd-slug-1", "prd-slug-2"],
      "recommendation": "how to reuse this pattern"
    }
  ],
  "conflicts": [
    {
      "prdSlug": "prd-slug",
      "conflict": "description of conflict",
      "severity": "low|medium|high",
      "mitigation": "how to resolve"
    }
  ],
  "architectureRecommendations": [
    {
      "area": "area of concern",
      "recommendation": "what to do",
      "rationale": "why this matters"
    }
  ],
  "estimatedComplexity": "low|medium|high",
  "summary": "2-3 sentence overview of audit findings"
}

Focus on actionable insights. Prioritize reuse over reinvention.`;
}

function buildUserPrompt(
  prdIndex: PrdIndexEntry[],
  codebaseIndex: CodebaseIndex
): string {
  const prdSummaries = prdIndex
    .map(
      (prd) =>
        `- ${prd.slug}: ${prd.oneLiner} (${prd.estimateMinutesTotal}min, risk: ${prd.riskLevel})`
    )
    .join("\n");

  const dbTables = codebaseIndex.dbTables.slice(0, 50).join(", ");
  const apiRoutes = codebaseIndex.apiRoutes
    .slice(0, 30)
    .map((r) => `${r.method} ${r.path}`)
    .join("\n  ");
  const exportCount = codebaseIndex.exports.length;
  const interfaceCount = codebaseIndex.interfaces.length;

  return `Analyze the following codebase and planned PRDs:

## Planned PRDs
${prdSummaries}

## Codebase Structure

**Database Tables (${codebaseIndex.dbTables.length} total):**
${dbTables}${codebaseIndex.dbTables.length > 50 ? "..." : ""}

**API Routes (${codebaseIndex.apiRoutes.length} total):**
  ${apiRoutes}${codebaseIndex.apiRoutes.length > 30 ? "\n  ..." : ""}

**Exports:** ${exportCount} functions/consts/classes/types
**Interfaces:** ${interfaceCount}

Identify:
1. Existing patterns these PRDs can reuse
2. Potential conflicts or naming collisions
3. Architecture recommendations for implementing these PRDs

Return valid JSON matching the schema.`;
}
