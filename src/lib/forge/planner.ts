/**
 * Forge Engine Planner — iter-0 plan mode with reuse-first discovery.
 *
 * Takes a validated spec.md and produces:
 * - stories: enriched with agentProfile, reuses[], verifiable checks
 * - dag: dependency graph (topologically sorted)
 * - reuseMap: map of story ID to reused file paths
 *
 * Process:
 * 1. Discovery pass — use Agent(Explore) to find reusable patterns/components/code
 * 2. Plan mode — generate implementation stories with reuse context
 * 3. Validate — check for cycles, estimate limits, schema compliance
 * 4. Consult ForgeLearning (if available) for known pitfalls
 */

import { validateSpec } from "./spec/validator";
import type { Spec, SpecStory } from "./spec/schema";
import { z } from "zod";

/**
 * Extended story schema for planning (beyond the spec.md format).
 * Adds fields needed for execution: agentProfile, reuses, verifiable checks.
 */
export const PlanStorySchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  description: z.string().optional(),
  acceptanceCriteria: z.array(z.string()).min(1),
  estimateMinutes: z.number().int().positive().max(30, "Stories must be ≤30min to fit in one context window"),
  dependsOn: z.array(z.string()).default([]),
  agentProfile: z.enum(["db", "api", "ui", "wiring", "test", "doc"]),
  reuses: z.array(z.string()).default([]), // file paths
  verifiable: z.array(z.object({
    kind: z.enum(["typecheck", "lint", "sql", "http", "manual_browser"]),
    command_or_query: z.string(),
    expected: z.string(),
  })).min(1, "Each story needs ≥1 verifiable check"),
  touches: z.array(z.string()).default([]), // predicted file paths
});

export type PlanStory = z.infer<typeof PlanStorySchema>;

export type DAGNode = {
  id: string;
  dependsOn: string[];
  depth: number; // topological depth
};

export type PlanResult = {
  stories: PlanStory[];
  dag: DAGNode[];
  reuseMap: Record<string, string[]>; // story id -> reused paths
  learnings?: string[]; // from ForgeLearning if available
};

export type PlanError = {
  type: "validation" | "cycle" | "estimate" | "schema";
  message: string;
  storyId?: string;
};

/**
 * Main planner function.
 *
 * @param specPath - absolute path to spec.md file
 * @returns PlanResult or throws with PlanError details
 */
export async function plan(specPath: string): Promise<PlanResult> {
  // Step 1: Validate spec
  const validationResult = validateSpec(specPath);
  if (!validationResult.ok) {
    const errorMsg = validationResult.errors.map(e => `${e.section || 'unknown'}: ${e.message}`).join("\n");
    throw {
      type: "validation" as const,
      message: `Spec validation failed:\n${errorMsg}`,
    } satisfies PlanError;
  }

  const spec = validationResult.spec;

  // Step 2: Discovery pass — find reusable code patterns
  const reuseMap = await runDiscoveryPass(spec);

  // Step 3: Enrich stories with agent profiles and verifiable checks
  const enrichedStories = await enrichStories(spec, reuseMap);

  // Step 4: Validate story schemas
  const validationErrors: PlanError[] = [];
  for (const story of enrichedStories) {
    const result = PlanStorySchema.safeParse(story);
    if (!result.success) {
      validationErrors.push({
        type: "schema",
        message: result.error.issues.map(i => i.message).join(", "),
        storyId: story.id,
      });
    }

    // Check estimate limit
    if (story.estimateMinutes && story.estimateMinutes > 30) {
      validationErrors.push({
        type: "estimate",
        message: `Story estimate ${story.estimateMinutes}min exceeds 30min limit`,
        storyId: story.id,
      });
    }
  }

  if (validationErrors.length > 0) {
    throw {
      type: "schema" as const,
      message: `Story validation failed:\n${validationErrors.map(e => `${e.storyId}: ${e.message}`).join("\n")}`,
    } satisfies PlanError;
  }

  // Step 5: Build DAG and detect cycles
  const dag = buildDAG(enrichedStories);
  const cycle = detectCycle(dag);
  if (cycle) {
    throw {
      type: "cycle" as const,
      message: `Dependency cycle detected: ${cycle.join(" → ")}`,
    } satisfies PlanError;
  }

  // Step 6: Consult ForgeLearning (if available)
  const learnings = await consultLearnings();

  return {
    stories: enrichedStories,
    dag,
    reuseMap,
    learnings,
  };
}

/**
 * Discovery pass: analyze codebase to find reusable patterns.
 * Uses Agent(Explore) to search for existing components, utilities, patterns.
 * Returns a map of story ID to array of reusable file paths.
 */
async function runDiscoveryPass(spec: Spec): Promise<Record<string, string[]>> {
  // For now, return empty map (green-field assumption)
  // In a real implementation, we'd spawn Agent(Explore) tasks to search
  // for patterns mentioned in each story's title/description.
  //
  // Example:
  // - Story about "auth middleware" → search for existing auth code
  // - Story about "user registration" → search for user models, validation
  // - Story about "JWT tokens" → search for existing token utilities
  //
  // This would write to a transcript.jsonl to make the discovery verifiable.

  const reuseMap: Record<string, string[]> = {};

  for (const story of spec.userStories) {
    // Placeholder: no reuse detected
    reuseMap[story.id] = [];
  }

  // TODO: Implement Agent(Explore) discovery
  // - Extract keywords from story title/description
  // - Search codebase with Glob/Grep patterns
  // - Return matching file paths
  // - Log to .forge/<slug>/discovery.jsonl for verification

  return reuseMap;
}

/**
 * Enrich stories with agent profiles, verifiable checks, and reuse context.
 * Infers agentProfile from story title/acceptanceCriteria.
 * Adds default verifiable checks (typecheck + story-specific).
 */
async function enrichStories(spec: Spec, reuseMap: Record<string, string[]>): Promise<PlanStory[]> {
  const enriched: PlanStory[] = [];

  for (const story of spec.userStories) {
    const profile = inferAgentProfile(story);
    const verifiable = inferVerifiableChecks(story, profile);
    const touches = inferTouchedFiles(story);

    enriched.push({
      id: story.id,
      title: story.title,
      description: story.description,
      acceptanceCriteria: story.acceptanceCriteria,
      estimateMinutes: story.estimateMinutes ?? 20, // default
      dependsOn: story.dependsOn ?? [],
      agentProfile: profile,
      reuses: reuseMap[story.id] ?? [],
      verifiable,
      touches,
    });
  }

  return enriched;
}

/**
 * Infer agent profile from story content.
 * Heuristics:
 * - "migration", "schema", "RLS" → db
 * - "endpoint", "route", "API" → api
 * - "component", "UI", "form" → ui
 * - "test", "spec" → test
 * - "documentation", "README" → doc
 * - otherwise → wiring
 */
function inferAgentProfile(story: SpecStory): PlanStory["agentProfile"] {
  const content = `${story.title} ${story.description ?? ""} ${story.acceptanceCriteria.join(" ")}`.toLowerCase();

  if (content.match(/\b(migration|schema|table|rls|policy|sql|database)\b/)) {
    return "db";
  }
  if (content.match(/\b(endpoint|route|api|handler|controller)\b/)) {
    return "api";
  }
  if (content.match(/\b(component|ui|form|button|sheet|dialog|page)\b/)) {
    return "ui";
  }
  if (content.match(/\b(test|spec|jest|vitest|playwright)\b/)) {
    return "test";
  }
  if (content.match(/\b(documentation|readme|docs|guide)\b/)) {
    return "doc";
  }

  return "wiring";
}

/**
 * Infer verifiable checks from story content.
 * Always includes typecheck. Adds profile-specific checks.
 */
function inferVerifiableChecks(story: SpecStory, profile: PlanStory["agentProfile"]): PlanStory["verifiable"] {
  const checks: PlanStory["verifiable"] = [
    {
      kind: "typecheck",
      command_or_query: "npx tsc --noEmit",
      expected: "exit 0",
    },
  ];

  // Profile-specific checks
  if (profile === "db") {
    // SQL validation would go here
    // For now, just typecheck
  }

  if (profile === "api") {
    // Could add HTTP endpoint smoke tests
    // checks.push({
    //   kind: "http",
    //   command_or_query: "curl -I http://localhost:3000/api/...",
    //   expected: "200",
    // });
  }

  if (profile === "ui") {
    // Could add manual browser checks
    checks.push({
      kind: "manual_browser",
      command_or_query: `echo "Manual verification: ${story.title}"`,
      expected: "visual check passed",
    });
  }

  return checks;
}

/**
 * Infer touched files from story acceptanceCriteria.
 * Looks for file paths mentioned in AC.
 */
function inferTouchedFiles(story: SpecStory): string[] {
  const paths: string[] = [];
  const pathPattern = /(?:^|\s)([\w\-\/\.]+\.(?:ts|tsx|js|jsx|sql|md))/g;

  for (const ac of story.acceptanceCriteria) {
    const matches = ac.matchAll(pathPattern);
    for (const match of matches) {
      paths.push(match[1]);
    }
  }

  return [...new Set(paths)]; // dedupe
}

/**
 * Build DAG from stories.
 * Computes topological depth for each node.
 */
function buildDAG(stories: PlanStory[]): DAGNode[] {
  const nodes: DAGNode[] = [];
  const depthMap = new Map<string, number>();

  // Initialize depth map
  for (const story of stories) {
    depthMap.set(story.id, 0);
  }

  // Compute depths via topological traversal
  let changed = true;
  while (changed) {
    changed = false;
    for (const story of stories) {
      const currentDepth = depthMap.get(story.id) ?? 0;
      const maxDepDep = Math.max(0, ...story.dependsOn.map(d => (depthMap.get(d) ?? 0) + 1));
      if (maxDepDep > currentDepth) {
        depthMap.set(story.id, maxDepDep);
        changed = true;
      }
    }
  }

  for (const story of stories) {
    nodes.push({
      id: story.id,
      dependsOn: story.dependsOn,
      depth: depthMap.get(story.id) ?? 0,
    });
  }

  // Sort by depth (topological order)
  nodes.sort((a, b) => a.depth - b.depth);

  return nodes;
}

/**
 * Detect cycle in DAG using DFS.
 * Returns array of story IDs forming the cycle, or null if acyclic.
 */
function detectCycle(dag: DAGNode[]): string[] | null {
  const adjList = new Map<string, string[]>();
  for (const node of dag) {
    adjList.set(node.id, node.dependsOn);
  }

  const visited = new Set<string>();
  const recStack = new Set<string>();
  const path: string[] = [];

  function dfs(nodeId: string): string[] | null {
    visited.add(nodeId);
    recStack.add(nodeId);
    path.push(nodeId);

    const deps = adjList.get(nodeId) ?? [];
    for (const dep of deps) {
      if (!visited.has(dep)) {
        const cycle = dfs(dep);
        if (cycle) return cycle;
      } else if (recStack.has(dep)) {
        // Cycle detected
        const cycleStart = path.indexOf(dep);
        return path.slice(cycleStart).concat(dep);
      }
    }

    recStack.delete(nodeId);
    path.pop();
    return null;
  }

  for (const node of dag) {
    if (!visited.has(node.id)) {
      const cycle = dfs(node.id);
      if (cycle) return cycle;
    }
  }

  return null;
}

/**
 * Consult ForgeLearning table for known pitfalls (Decision D22).
 * Returns array of learning strings, or empty if table doesn't exist yet.
 */
async function consultLearnings(): Promise<string[] | undefined> {
  // TODO: Query ForgeLearning table
  // For now, return undefined (table may not exist until FE-013)
  return undefined;
}
