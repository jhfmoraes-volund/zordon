#!/usr/bin/env tsx
/**
 * Test script for the forge planner.
 * Runs the planner on the example spec and verifies the output.
 */

import { plan } from "../../src/lib/forge/planner";
import { resolve } from "node:path";
import { writeFileSync, mkdirSync } from "node:fs";

async function testPlan() {
  const specPath = resolve(process.cwd(), "docs/specs/example.md");

  console.log("Testing planner with example.md...");

  try {
    const result = await plan(specPath);

    console.log("✓ Plan succeeded");
    console.log("");
    console.log("Stories:", result.stories.length);
    console.log("DAG nodes:", result.dag.length);
    console.log("");

    // Write output
    const forgeDir = ".forge/example";
    mkdirSync(forgeDir, { recursive: true });

    const planPath = `${forgeDir}/plan.jsonl`;
    const jsonlContent = result.stories.map(s => JSON.stringify(s)).join("\n");
    writeFileSync(planPath, jsonlContent);

    console.log(`Written to ${planPath}`);
    console.log("");
    console.log("First story ID:", result.stories[0]?.id);

    process.exit(0);
  } catch (err: any) {
    console.error("✗ Plan failed");
    console.error(err);
    process.exit(1);
  }
}

testPlan();
