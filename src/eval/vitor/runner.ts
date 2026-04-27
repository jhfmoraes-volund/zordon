/**
 * Eval runner — entry point.
 *
 * Modes:
 *   default:           dry-run — validates schema, shows baseline predictions
 *   --live             actually invokes Vitor against seeded fixtures
 *
 * Flags (used with --live):
 *   --case=<name>      run only one case by name
 *   --keep             don't cleanup test fixtures (for inspection)
 *   --no-budget        bypass the safety cap on number of cases
 *
 * Run via: npm run eval:vitor [-- --live --case=smoke-persona-grounding]
 */

import { allCases } from "./cases";
import type { EvalCase } from "./types";

interface DryRunReport {
  totalCases: number;
  byPhase: Record<string, number>;
  runnableToday: number;
  blockedByPhase: number;
  baselinePredictions: { pass: number; partial: number; fail: number };
  perCase: {
    name: string;
    title: string;
    category: number;
    phaseDependency: number;
    runnableToday: boolean;
    baselinePrediction: string;
  }[];
}

function validateCase(c: EvalCase): string[] {
  const issues: string[] = [];
  if (!c.name || !/^[a-z0-9-]+$/.test(c.name))
    issues.push(`invalid name "${c.name}" (kebab-case required)`);
  if (c.category < 0 || c.category > 10)
    issues.push(`category ${c.category} out of range 0-10`);
  if (!c.turns?.length) issues.push("at least one turn required");
  if (!c.expected) issues.push("expected block missing");
  if (
    !c.expected?.toolCalls?.length &&
    !c.expected?.responseContains?.length &&
    !c.expected?.judgeRubric
  ) {
    issues.push("expected block has no assertions (toolCalls/contains/rubric all empty)");
  }
  if (!c.baselineRationale) issues.push("baselineRationale required for honest baseline");
  return issues;
}

function buildReport(cases: EvalCase[]): DryRunReport {
  const byPhase: Record<string, number> = {};
  const baselinePredictions = { pass: 0, partial: 0, fail: 0 };
  for (const c of cases) {
    byPhase[String(c.phaseDependency)] = (byPhase[String(c.phaseDependency)] ?? 0) + 1;
    baselinePredictions[c.baselinePrediction]++;
  }
  return {
    totalCases: cases.length,
    byPhase,
    runnableToday: cases.filter((c) => c.runnableToday).length,
    blockedByPhase: cases.filter((c) => !c.runnableToday).length,
    baselinePredictions,
    perCase: cases.map((c) => ({
      name: c.name,
      title: c.title,
      category: c.category,
      phaseDependency: c.phaseDependency,
      runnableToday: c.runnableToday,
      baselinePrediction: c.baselinePrediction,
    })),
  };
}

function printReport(report: DryRunReport): void {
  console.log("\n=== Vitor Eval Suite — Dry Run ===\n");
  console.log(`Total cases: ${report.totalCases}`);
  console.log(`Runnable today: ${report.runnableToday}`);
  console.log(`Blocked by future phases: ${report.blockedByPhase}`);
  console.log("\nBy phase dependency:");
  for (const [phase, count] of Object.entries(report.byPhase).sort()) {
    console.log(`  Phase ${phase}: ${count} case(s)`);
  }
  console.log("\nBaseline prediction (vs current Vitor):");
  console.log(`  pass:    ${report.baselinePredictions.pass}`);
  console.log(`  partial: ${report.baselinePredictions.partial}`);
  console.log(`  fail:    ${report.baselinePredictions.fail}`);
  console.log("\nPer case:");
  for (const c of report.perCase) {
    const flag = c.runnableToday ? "RUN" : `P${c.phaseDependency}`;
    const pad = c.name.padEnd(32);
    console.log(`  [${flag}] ${pad} ${c.baselinePrediction.padEnd(7)} ${c.title}`);
  }
  console.log("");
}

function parseArgs(argv: string[]): {
  live: boolean;
  caseFilter?: string;
  keep: boolean;
  noBudget: boolean;
  llmJudge: boolean;
} {
  const live = argv.includes("--live");
  const keep = argv.includes("--keep");
  const noBudget = argv.includes("--no-budget");
  const llmJudge = argv.includes("--llm-judge");
  const caseArg = argv.find((a) => a.startsWith("--case="));
  const caseFilter = caseArg ? caseArg.split("=")[1] : undefined;
  return { live, caseFilter, keep, noBudget, llmJudge };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  let hasIssues = false;
  for (const c of allCases) {
    const issues = validateCase(c);
    if (issues.length) {
      hasIssues = true;
      console.error(`\n[INVALID] ${c.name}:`);
      issues.forEach((i) => console.error(`  - ${i}`));
    }
  }
  if (hasIssues) {
    console.error("\nFix invalid cases before running. Aborting.\n");
    process.exit(1);
  }

  if (!args.live) {
    const report = buildReport(allCases);
    printReport(report);
    console.log(
      "Next steps:\n" +
        "  1. Read src/eval/vitor/baselines/2026-04-27.md for the manual baseline.\n" +
        "  2. Run live: npm run eval:vitor -- --live --case=smoke-persona-grounding\n" +
        "  3. After each phase, re-run and compare predictions to actuals.\n",
    );
    return;
  }

  console.log("\n=== Vitor Eval Suite — Live Mode ===");
  console.log(
    args.caseFilter
      ? `Filter: case=${args.caseFilter}`
      : `Running all ${allCases.length} cases (skipping those that need future infra)`,
  );
  console.log(`Keep fixtures: ${args.keep ? "yes" : "no"}`);
  console.log("Cost: ~$0.02-0.05 per turn against Sonnet 4.6\n");

  const { runLive } = await import("./live");
  await runLive(allCases, {
    caseFilter: args.caseFilter,
    keep: args.keep,
    budgetMaxCases: args.noBudget ? undefined : 5,
    llmJudge: args.llmJudge,
  });
}

main().catch((err) => {
  console.error("\n[fatal]", err);
  process.exit(1);
});
