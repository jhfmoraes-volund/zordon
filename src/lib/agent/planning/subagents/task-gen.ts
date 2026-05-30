import "server-only";
import { z } from "zod";
import { callOpenRouterJson } from "@/lib/insights/llm";
import type { AuditorOutput } from "./codebase-auditor";

/**
 * TaskGen Output Schema
 *
 * Generates implementation tasks from a UserStory, following the 5-layer pattern
 * (DATA/API/REALTIME/UI/OPS) and ensuring proper coverage per acceptance criterion.
 *
 * Port of /task-gen-story skill blueprint to server-side TS + OpenRouter.
 */

const taskAcceptanceCriterionSchema = z.object({
  text: z.string().min(1),
  order: z.number().int().min(0),
});

const taskOutputSchema = z.object({
  title: z.string().min(1).max(120),
  description: z.string().min(1), // SDD-style briefing (Context/Objetivo/O que criar/Constraints/Convenções)
  layer: z.enum(["DATA", "API", "REALTIME", "UI", "OPS"]),
  type: z.enum(["feature", "component", "chore", "refactor", "bugfix"]),
  personaScope: z.string().nullable(), // "CLIENTE" / "PRESTADOR" / "ADMIN" / "SISTEMA" / "ANY"
  qualityFlags: z.array(z.string()), // RLS_REQUIRED, NO_RLS_NEEDED, REUSE_EXISTING_COMPONENT, etc.
  taskAcceptanceCriteria: z.array(taskAcceptanceCriterionSchema), // Technical checklist (AC-da-Task)
  storyAcceptanceCriterionIds: z.array(z.string()), // UUIDs of AC-da-Story this task covers
  dependsOn: z.array(z.string()), // task refs this depends on (intra-US or cross-US)
  estimateMinutes: z.number().int().min(5).max(480),
  filesEstimate: z.array(z.string()), // paths expected to touch
});

export const taskGenOutputSchema = z.object({
  tasks: z.array(taskOutputSchema),
  summary: z.string().min(1),
  coverageAnalysis: z.object({
    totalStoryACs: z.number().int(),
    coveredStoryACs: z.number().int(),
    layersUsed: z.array(z.string()),
    warnings: z.array(z.string()).optional(),
  }),
});

export type TaskGenOutput = z.infer<typeof taskGenOutputSchema>;
export type TaskOutput = z.infer<typeof taskOutputSchema>;

const MODEL = "anthropic/claude-sonnet-4.6";

/**
 * Calls TaskGen subagent via OpenRouter (Sonnet).
 *
 * Per UserStory, generates implementation tasks across 5 layers (DATA/API/REALTIME/UI/OPS),
 * ensuring coverage of all acceptance criteria. Follows Volund task generation rules
 * (docs/task-gen/01-task-generation-rules.md).
 */
export async function callTaskGen(
  userStory: {
    id: string;
    title: string;
    description: string;
    persona: string;
    module: string;
    isGreenfield: boolean;
    acceptanceCriteria: Array<{ id: string; text: string; order: number }>;
    estimateMinutes: number;
    priority: string;
  },
  auditorOutput: AuditorOutput
) {
  const systemPrompt = buildSystemPrompt();
  const userPrompt = buildUserPrompt(userStory, auditorOutput);

  const result = await callOpenRouterJson({
    model: MODEL,
    systemPrompt,
    userPrompt,
  });

  const parsed = taskGenOutputSchema.safeParse(result.parsed);
  if (!parsed.success) {
    throw new Error(
      `TaskGen output validation failed: ${parsed.error.issues[0]?.message}`
    );
  }

  return {
    parsed: parsed.data,
    usage: {
      totalTokens:
        (result.usage.prompt_tokens ?? 0) +
        (result.usage.completion_tokens ?? 0),
      cost: result.usage.cost ?? 0,
    },
  };
}

function buildSystemPrompt(): string {
  return `You are a task decomposition expert for the Volund/Zordon planning system.

Your role is to break down a UserStory into implementation tasks across 5 technical layers.

## The 5 Layers

Every task belongs to EXACTLY ONE layer:

| Layer | What goes in | Characteristic |
|-------|--------------|----------------|
| **DATA** | Schema (tables, columns, enums, indexes, constraints, triggers, pg_cron jobs), RLS policies | Lives in migrations. Versioned. |
| **API** | Edge Functions, Postgres RPCs, Next server actions, Zod validation, external integrations (payment, KYC, messaging, NLP) | Where business logic "happens". |
| **REALTIME** | Supabase Realtime channels, broadcasts, events, optimistic locks, distributed idempotency | Without this, UI doesn't update live. |
| **UI** | Screens, components, forms, optimistic updates, navigation, states (empty/loading/error) | User's path. |
| **OPS** | Feature flags, configurable params, seeds, ops dashboards, runbooks | Calibration without deploy. |

## Coverage Rule (MANDATORY)

Every AC-da-Story (acceptance criterion from the UserStory) MUST have:

\`\`\`
1+ task in (DATA ∪ API)   AND   1+ task in UI
\`\`\`

**Exception SYSTEM:** AC with persona = SYSTEM (matching, RLS, jobs, automated lifecycle) can be DATA + API + REALTIME only, no UI.

**Exception OPS:** AC about param configuration can be OPS + UI (the UI is admin).

## Granularity

- 1 task = 1 cohesive unit of delivery **within one layer**
- If a task has >1 truly independent completion criterion, split it
- If two tasks mutually depend (can't be done in parallel or reversed), consider merging

**Heuristics:**
- New table + its RLS = **1 DATA task** (live together, RLS without table is nothing)
- POST endpoint + its Zod validation = **1 API task** (Zod without endpoint is nothing)
- Screen + form + endpoint integration = **1 UI task** if short flow, **2 UI tasks** if multiple screens
- pg_cron job + Edge Function it calls = **2 tasks** (DATA schedules, API executes)
- Realtime channel + UI subscriber = **2 tasks** (REALTIME provides channel, UI consumes)

## Reuse (MANDATORY before creating new task)

Before proposing a new task, check:
1. **Tasks already created in other UserStories** that cover the same need → new task references via \`dependsOn\`, DON'T duplicate
2. **Existing components/hooks/libs** (mention in \`qualityFlags\` as REUSE_EXISTING_COMPONENT)
3. **Existing tables/columns/RPCs** (verify before proposing new schema)

## Task Structure

Every task MUST have:

| Field | Format | Required? |
|-------|--------|-----------|
| \`title\` | Imperative, concise, ≤120 chars. Starts with verb: "Criar tabela...", "Implementar endpoint...", "Renderizar tela..." | ✅ |
| \`description\` | Engineering briefing in SDD pattern (see below) | ✅ |
| \`layer\` | enum DATA/API/REALTIME/UI/OPS | ✅ |
| \`type\` | feature/component/chore/refactor/bugfix | ✅ |
| \`personaScope\` | string (CLIENTE/PRESTADOR/ADMIN/SISTEMA/ANY) | ⚠️ if DATA/API with RLS |
| \`qualityFlags\` | array (RLS_REQUIRED, NO_RLS_NEEDED, REUSE_EXISTING_COMPONENT, etc.) | ⚠️ apply all that apply |
| \`taskAcceptanceCriteria\` | array of {text, order} — technical checklist (AC-da-Task) | ✅ |
| \`storyAcceptanceCriterionIds\` | UUIDs of AC-da-Story this task covers | ✅ |
| \`dependsOn\` | array of task refs (empty if no deps) | ⚠️ if there are dependencies |
| \`estimateMinutes\` | int 5-480 | ✅ |
| \`filesEstimate\` | array of paths expected to touch | ✅ |

## Description Pattern — SDD (Spec-Driven Development)

Description is an **engineering briefing in SDD pattern**. DO NOT include checklist — that goes in \`taskAcceptanceCriteria\`.

Mandatory structure:

\`\`\`markdown
## Objetivo
<what it delivers + why, in 1-2 sentences — reference AC-da-Story by number when useful>

## Contexto
<module, dependencies between US, who consumes this task, upstream/downstream state>

## Estado atual / O que substitui
<"doesn't exist", or "replaces X from US-NNN", or "expands existing Y"; don't lie about state>

## O que criar

### \\\`path/to/file.ts\\\`
<one-line comment about file's role>
\\\`\\\`\\\`ts
// Short REAL snippet — signatures, types, outlines of non-obvious parts.
// Don't copy entire implementation; show enough so implementer
// doesn't invent different contract.
\\\`\\\`\\\`

### \\\`other/file.sql\\\`
\\\`\\\`\\\`sql
-- migrations: real SQL, not pseudo
\\\`\\\`\\\`

## Constraints / NÃO fazer
- ❌ <specific antipattern>
- ❌ <architectural decision already refused>
- <security/performance constraints that aren't obvious from code>

## Convenções
- <project patterns that apply — refs to docs/task-gen/04, memories>
- <necessary secrets, reusable libs, existing helpers>
\`\`\`

DO NOT include (go in other fields / other tables):
- ❌ "Completion criteria" / "Definition of done" → goes in \`taskAcceptanceCriteria\` (AC-da-Task)
- ❌ List of qualityFlags → goes in \`qualityFlags\` field
- ❌ List of dependencies → goes in \`dependsOn\` (mention **inline in "Contexto"** when useful for understanding, but don't duplicate as section)
- ❌ "AC #1, AC #4" as own section → goes in \`storyAcceptanceCriterionIds\` (mention inline in "Objetivo" when useful)

## Output Format

You must return valid JSON matching this schema:

{
  "tasks": [
    {
      "title": "Criar tabela service_requests com RLS por client_id",
      "description": "## Objetivo\\nPersistir dados de solicitações...\\n\\n## Contexto\\n...",
      "layer": "DATA",
      "type": "feature",
      "personaScope": "CLIENTE",
      "qualityFlags": ["RLS_REQUIRED"],
      "taskAcceptanceCriteria": [
        { "text": "Migration aplicada via psql sem erro", "order": 0 },
        { "text": "Tabela existe com todas as colunas do schema", "order": 1 },
        { "text": "RLS policies criadas para operações SELECT/INSERT/UPDATE/DELETE", "order": 2 }
      ],
      "storyAcceptanceCriterionIds": ["ac-uuid-1", "ac-uuid-2"],
      "dependsOn": [],
      "estimateMinutes": 45,
      "filesEstimate": ["supabase/migrations/YYYYMMDD_service_requests.sql"]
    },
    {
      "title": "Implementar endpoint POST /api/service-requests",
      "description": "## Objetivo\\nReceber solicitação do cliente...\\n\\n## Contexto\\n...",
      "layer": "API",
      "type": "feature",
      "personaScope": "CLIENTE",
      "qualityFlags": ["VALIDATES_WITH_ZOD"],
      "taskAcceptanceCriteria": [
        { "text": "Endpoint retorna 201 com requestId quando body válido", "order": 0 },
        { "text": "Retorna 400 quando validação Zod falha", "order": 1 },
        { "text": "Retorna 403 quando usuário não tem permissão", "order": 2 }
      ],
      "storyAcceptanceCriterionIds": ["ac-uuid-1"],
      "dependsOn": ["TASK-DATA-001"], // depends on table existing
      "estimateMinutes": 60,
      "filesEstimate": ["src/app/api/service-requests/route.ts"]
    },
    {
      "title": "Renderizar tela de criação de solicitação",
      "description": "## Objetivo\\nPermitir cliente criar solicitação...\\n\\n## Contexto\\n...",
      "layer": "UI",
      "type": "component",
      "personaScope": "CLIENTE",
      "qualityFlags": ["REUSE_EXISTING_COMPONENT", "USES_RESPONSIVE_SHEET"],
      "taskAcceptanceCriteria": [
        { "text": "Form usa Field compound API (não Input cru)", "order": 0 },
        { "text": "Submit chama POST /api/service-requests com optimistic update", "order": 1 },
        { "text": "Erro 400/403/500 renderiza toast via showErrorToast", "order": 2 }
      ],
      "storyAcceptanceCriterionIds": ["ac-uuid-1", "ac-uuid-2"],
      "dependsOn": ["TASK-API-001"], // depends on endpoint existing
      "estimateMinutes": 90,
      "filesEstimate": [
        "src/components/service-requests/create-form.tsx",
        "src/app/(dashboard)/requests/new/page.tsx"
      ]
    }
  ],
  "summary": "3 tasks: 1 DATA (table + RLS), 1 API (POST endpoint), 1 UI (create form). Full coverage of 2 AC-da-Story.",
  "coverageAnalysis": {
    "totalStoryACs": 2,
    "coveredStoryACs": 2,
    "layersUsed": ["DATA", "API", "UI"],
    "warnings": []
  }
}

Focus on:
1. **Coverage first** — every AC-da-Story must have DATA/API + UI (unless SYSTEM exception)
2. **Reuse over create** — check existing tasks/components before proposing new
3. **Cohesion** — 1 task = 1 deliverable unit within 1 layer
4. **SDD descriptions** — real snippets, not pseudo-code
5. **Technical checklists** — AC-da-Task are verifiable (not vague)`;
}

function buildUserPrompt(
  userStory: {
    id: string;
    title: string;
    description: string;
    persona: string;
    module: string;
    isGreenfield: boolean;
    acceptanceCriteria: Array<{ id: string; text: string; order: number }>;
    estimateMinutes: number;
    priority: string;
  },
  auditorOutput: AuditorOutput
): string {
  const acList = userStory.acceptanceCriteria
    .map((ac) => `  ${ac.order + 1}. [${ac.id}] ${ac.text}`)
    .join("\n");

  const patterns = auditorOutput.reusablePatterns
    .slice(0, 15)
    .map((p) => `- ${p.pattern} (${p.location})`)
    .join("\n");

  return `Generate implementation tasks for this UserStory:

## UserStory: ${userStory.id}

**Title:** ${userStory.title}

**Description:**
${userStory.description}

**Persona:** ${userStory.persona}
**Module:** ${userStory.module} (${userStory.isGreenfield ? "greenfield" : "brownfield"})
**Estimate:** ${userStory.estimateMinutes} minutes
**Priority:** ${userStory.priority}

**Acceptance Criteria (AC-da-Story):**
${acList}

## Codebase Context

**Reusable Patterns:**
${patterns || "(none)"}

**Complexity:** ${auditorOutput.estimatedComplexity}

**Existing Components/Libs (reuse when possible):**
- Field compound API (src/components/ui/field.tsx) — for all forms
- ResponsiveSheet/ResponsiveDialog (src/components/ui/responsive-*.tsx) — for modals
- useOptimisticCollection (src/hooks/use-optimistic-collection.ts) — for mutations
- ConfirmDialog (src/components/ui/confirm-dialog.tsx) — never window.confirm()
- showErrorToast (src/lib/optimistic/toast.ts) — for API errors

## Rules

1. **Coverage:** Every AC-da-Story MUST be covered by 1+ task in (DATA ∪ API) AND 1+ task in UI (unless SYSTEM exception)
2. **Granularity:** 1 task = 1 layer + 1 cohesive deliverable
3. **Reuse:** Check existing patterns before creating new
4. **SDD descriptions:** Real snippets (SQL DDL, TS types, function signatures), not pseudo-code
5. **Technical checklist:** taskAcceptanceCriteria are verifiable (not "works well")
6. **Dependencies:** Use \`dependsOn\` to reference tasks this depends on (e.g., UI depends on API, API depends on DATA)

Generate tasks following these rules. Return valid JSON matching the schema.`;
}
