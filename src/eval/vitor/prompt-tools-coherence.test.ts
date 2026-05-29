/**
 * Regression test: prompt-tools-coherence
 *
 * Ensures Vitor's prompt no longer references removed story/task tools
 * (create_user_story, update_user_story, delete_user_story,
 * set_story_refinement, manage_story_ac, create_task, update_task, delete_task)
 * and instead references PRD tools (propose_prd, update_prd, approve_prd).
 *
 * Run: npx tsx src/eval/vitor/prompt-tools-coherence.test.ts
 */

import assert from "node:assert/strict";
import { buildSystemPrompt } from "../../lib/agent/prompt";

// Build minimal prompt to check content
const result = buildSystemPrompt({
  sessionTitle: "Test Session",
  sessionType: "inception",
  selectedSteps: null,
  currentStepKey: "briefing",
  sessionContext: "Test context",
  briefingSubPhase: "prd_drafting",
  briefingTargetStoryId: null,
  hasWebSearch: false,
  activeDecisions: [],
  openQuestions: [],
  businessContext: null,
  projectMemoryMd: null,
  sessionIndex: [],
  transcripts: [],
  existingModules: [],
  existingStories: [],
  existingPersonas: [],
  planMode: false,
});

const fullPrompt = result.stable + "\n" + result.volatile;

// ─── Test 1: No references to removed story/task tools ─────────────────────

const removedToolsPattern = /\b(create_user_story|update_user_story|delete_user_story|set_story_refinement|manage_story_ac|create_task|update_task|delete_task)\b/g;
const removedToolMatches = fullPrompt.match(removedToolsPattern);

if (removedToolMatches && removedToolMatches.length > 0) {
  console.error(`✗ Found ${removedToolMatches.length} reference(s) to removed tools:`);
  console.error(`  ${removedToolMatches.join(", ")}`);
  process.exit(1);
}
console.log("✓ No references to removed story/task tools");

// ─── Test 2: Contains references to PRD tools ──────────────────────────────

const requiredTools = ["propose_prd", "update_prd", "approve_prd"];
const missingTools: string[] = [];

for (const tool of requiredTools) {
  if (!fullPrompt.includes(tool)) {
    missingTools.push(tool);
  }
}

if (missingTools.length > 0) {
  console.error(`✗ Missing required PRD tools: ${missingTools.join(", ")}`);
  process.exit(1);
}
console.log("✓ All required PRD tools present (propose_prd, update_prd, approve_prd)");

// ─── Test 3: No references to old sub-phase names ──────────────────────────

const oldSubPhasePattern = /\b(STORY_TREE|STORY_DETAIL|TASK_BREAKDOWN|story_tree|story_detail|task_breakdown)\b/g;
const oldSubPhaseMatches = fullPrompt.match(oldSubPhasePattern);

if (oldSubPhaseMatches && oldSubPhaseMatches.length > 0) {
  console.error(`✗ Found ${oldSubPhaseMatches.length} reference(s) to old sub-phase names:`);
  console.error(`  ${oldSubPhaseMatches.join(", ")}`);
  process.exit(1);
}
console.log("✓ No references to old sub-phase names (STORY_TREE, STORY_DETAIL, TASK_BREAKDOWN)");

// ─── Test 4: Contains new sub-phase names ──────────────────────────────────

const newSubPhases = ["PRD_DRAFTING", "PRD_REVIEW"];
const missingSubPhases: string[] = [];

for (const subPhase of newSubPhases) {
  // Check both constant form (PRD_DRAFTING) and value form (prd_drafting)
  const constantForm = subPhase;
  const valueForm = subPhase.toLowerCase();

  if (!fullPrompt.includes(constantForm) && !fullPrompt.includes(valueForm)) {
    missingSubPhases.push(subPhase);
  }
}

if (missingSubPhases.length > 0) {
  console.error(`✗ Missing required sub-phases: ${missingSubPhases.join(", ")}`);
  process.exit(1);
}
console.log("✓ New sub-phase names present (PRD_DRAFTING, PRD_REVIEW)");

// ─── Success ────────────────────────────────────────────────────────────────

console.log("\n✓ All prompt-tools-coherence checks passed");
