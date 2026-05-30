import "server-only";
import { z } from "zod";
import { callOpenRouterJson } from "@/lib/insights/llm";
import type { PrdIndexEntry } from "../prd-index";
import type { AuditorOutput } from "./codebase-auditor";

/**
 * Story Decomposer Output Schema
 *
 * Extracts UserStories from PRDs, matching them to existing personas and modules.
 */
export const storyDecomposerOutputSchema = z.object({
  stories: z.array(
    z.object({
      prdSlug: z.string().min(1),
      title: z.string().min(1),
      description: z.string().min(1),
      persona: z.string().min(1), // "owner", "builder", "pm", etc.
      module: z.string().min(1), // module name (greenfield or existing)
      isGreenfield: z.boolean(),
      acceptanceCriteria: z.array(z.string()),
      estimateMinutes: z.number().int().min(1),
      priority: z.enum(["critical", "high", "medium", "low"]),
      reasoning: z.string().min(1),
    })
  ),
  summary: z.string().min(1),
});

export type StoryDecomposerOutput = z.infer<typeof storyDecomposerOutputSchema>;

const MODEL = "anthropic/claude-sonnet-4.6";

/**
 * Calls the Story Decomposer subagent via OpenRouter (Sonnet).
 *
 * Per PRD, extracts UserStories matched to personas and modules from the codebase.
 */
export async function callStoryDecomposer(
  prdIndex: PrdIndexEntry[],
  auditorOutput: AuditorOutput
): Promise<StoryDecomposerOutput> {
  const systemPrompt = buildSystemPrompt();
  const userPrompt = buildUserPrompt(prdIndex, auditorOutput);

  const result = await callOpenRouterJson({
    model: MODEL,
    systemPrompt,
    userPrompt,
  });

  const parsed = storyDecomposerOutputSchema.safeParse(result.parsed);
  if (!parsed.success) {
    throw new Error(
      `Story decomposer output validation failed: ${parsed.error.issues[0]?.message}`
    );
  }

  return parsed.data;
}

function buildSystemPrompt(): string {
  return `You are a story decomposition expert for the Volund planning system.

Your role is to:
1. Extract UserStories from PRDs (§16 or inferred from §4 personas + jornada)
2. Match stories to personas (owner, builder, pm, etc.)
3. Assign stories to modules (greenfield or existing)
4. Define clear acceptance criteria
5. Estimate effort in minutes
6. Prioritize stories

You must return valid JSON matching this schema:

{
  "stories": [
    {
      "prdSlug": "planning-session",
      "title": "Owner can view planning session board",
      "description": "As Owner, I need to see PRDs distributed across sprints",
      "persona": "owner",
      "module": "planning-session",
      "isGreenfield": true,
      "acceptanceCriteria": [
        "Board renders N sprint columns based on sprintCount",
        "PRD cards show in correct sprint column"
      ],
      "estimateMinutes": 45,
      "priority": "high",
      "reasoning": "Core UX for the planning feature"
    }
  ],
  "summary": "2-3 sentence overview of extracted stories"
}

Focus on user-facing value. Prioritize by business impact.`;
}

function buildUserPrompt(
  prdIndex: PrdIndexEntry[],
  auditorOutput: AuditorOutput
): string {
  const prdSummaries = prdIndex
    .map(
      (prd) =>
        `## ${prd.slug}
Title: ${prd.title}
Problem: ${prd.problemSummary}
Solution: ${prd.oneLiner}
Personas: ${prd.personaIds.join(", ")}
Estimate: ${prd.estimateMinutesTotal}min
Risk: ${prd.riskLevel}`
    )
    .join("\n\n");

  const patterns = auditorOutput.reusablePatterns
    .slice(0, 10)
    .map((p) => `- ${p.pattern} (${p.location})`)
    .join("\n");

  return `Extract UserStories from these PRDs:

${prdSummaries}

## Codebase Context

**Reusable Patterns:**
${patterns || "(none)"}

**Complexity:** ${auditorOutput.estimatedComplexity}

Extract stories following these rules:
1. One story per user-facing capability (not per technical task)
2. Match stories to personas from §4 (owner, builder, pm, etc.)
3. Assign to modules — check if greenfield or existing
4. Each story should have 2-5 clear, testable acceptance criteria
5. Estimate realistically (15-90 minutes per story)
6. Prioritize by business impact and dependencies

Return valid JSON matching the schema.`;
}
