#!/usr/bin/env tsx
/**
 * Forge CLI — command-line interface for Forge Engine operations.
 *
 * Subcommands:
 * - spec validate <path>  — validate a spec.md file
 * - plan <slug>           — generate execution plan from spec
 *
 * Usage: tsx scripts/forge/cli.ts <subcommand> [args...]
 */
import { validateSpec } from "../../src/lib/forge/spec/validator";
import { plan } from "../../src/lib/forge/planner";
import { resolve } from "node:path";
import { writeFileSync, mkdirSync } from "node:fs";

const [, , subcommand, ...args] = process.argv;

if (!subcommand) {
  console.error("usage: forge-cli <subcommand> [args...]");
  console.error("");
  console.error("subcommands:");
  console.error("  spec validate <path>  — validate a spec.md file");
  console.error("  plan <slug>           — generate execution plan from spec");
  process.exit(64);
}

// ── spec validate ────────────────────────────────────────────────────────

if (subcommand === "spec" && args[0] === "validate") {
  const specPath = args[1];

  if (!specPath) {
    console.error("usage: forge-cli spec validate <path>");
    process.exit(64);
  }

  const absolutePath = resolve(process.cwd(), specPath);
  const result = validateSpec(absolutePath);

  if (result.ok) {
    console.log("✓ Spec is valid");
    console.log("");
    console.log(`  Problem: ${result.spec.problem.slice(0, 80)}...`);
    console.log(`  Solution: ${result.spec.solution}`);
    console.log(`  Stories: ${result.spec.userStories.length}`);
    console.log(`  Success criteria: ${result.spec.successCriteria.length}`);
    if (result.spec.upstream) {
      console.log(`  Upstream refs: ${result.spec.upstream.length}`);
    }
    process.exit(0);
  } else {
    console.error("✗ Spec validation failed");
    console.error("");
    for (const error of result.errors) {
      const location = error.line > 0 ? `${error.line}:${error.column}` : "(unknown)";
      const section = error.section ? `[${error.section}] ` : "";
      console.error(`  ${location} ${section}${error.message}`);
    }
    process.exit(1);
  }
}

// ── plan ─────────────────────────────────────────────────────────────────

if (subcommand === "plan") {
  const slug = args[0];

  if (!slug) {
    console.error("usage: forge-cli plan <slug>");
    console.error("");
    console.error("examples:");
    console.error("  forge-cli plan example          — plan from docs/specs/example.md");
    console.error("  forge-cli plan my-feature       — plan from docs/specs/active/my-feature.md");
    process.exit(64);
  }

  // Resolve spec path
  let specPath = `docs/specs/active/${slug}.md`;
  try {
    // Check if slug is a direct path
    if (slug.includes("/") || slug.endsWith(".md")) {
      specPath = slug;
    } else if (slug === "example") {
      specPath = "docs/specs/example.md";
    }
  } catch {
    // Use default path
  }

  const absoluteSpecPath = resolve(process.cwd(), specPath);

  (async () => {
    try {
      console.log(`→ Planning from ${specPath}...`);
      const result = await plan(absoluteSpecPath);

      // Write to .forge/<slug>/plan.jsonl
      const forgeDir = `.forge/${slug}`;
      mkdirSync(forgeDir, { recursive: true });

      const planPath = `${forgeDir}/plan.jsonl`;
      const jsonlContent = result.stories.map(s => JSON.stringify(s)).join("\n");
      writeFileSync(planPath, jsonlContent);

      console.log("✓ Plan generated");
      console.log("");
      console.log(`  Stories: ${result.stories.length}`);
      console.log(`  DAG depth: ${Math.max(...result.dag.map(n => n.depth))}`);
      console.log(`  Reuse opportunities: ${Object.values(result.reuseMap).flat().length}`);
      if (result.learnings && result.learnings.length > 0) {
        console.log(`  Learnings consulted: ${result.learnings.length}`);
      }
      console.log("");
      console.log(`  Written to: ${planPath}`);

      process.exit(0);
    } catch (err: any) {
      console.error("✗ Planning failed");
      console.error("");
      console.error(`  ${err.type ?? "error"}: ${err.message ?? err}`);
      process.exit(1);
    }
  })();

  // Exit early to prevent "unknown subcommand" from running
  // The async IIFE will handle process.exit
} else {
  // ── unknown subcommand ───────────────────────────────────────────────────
  console.error(`unknown subcommand: ${subcommand}`);
  process.exit(64);
}
