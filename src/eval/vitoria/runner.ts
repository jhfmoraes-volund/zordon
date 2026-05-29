/**
 * Vitoria eval runner — entry point.
 *
 * Modes:
 *   default          dry-run — validates schema, prints baseline predictions per scenario
 *   --case=<name>    filter by scenario name (works in dry-run too)
 *
 * Live mode (--live) is NOT wired in v1. Each scenario depends on infra that
 * later phases (G1-G7 of vitoria-v2-runbook.md) introduce. Live wiring lands
 * incrementally as phases ship — same staging strategy used by src/eval/vitor.
 *
 * Run via: pnpm eval:vitoria
 */

import { allScenarios } from "./cases";
import type { EvalScenario } from "./types";

interface DryRunReport {
  totalScenarios: number;
  byPhase: Record<string, number>;
  runnableToday: number;
  blockedByPhase: number;
  baselinePredictions: { pass: number; partial: number; fail: number };
  perScenario: {
    name: string;
    title: string;
    phaseDependency: number;
    runnableToday: boolean;
    baselinePrediction: string;
  }[];
}

function validateScenario(s: EvalScenario): string[] {
  const issues: string[] = [];
  if (!s.name || !/^[a-z0-9-]+$/.test(s.name))
    issues.push(`invalid name "${s.name}" (kebab-case required)`);
  if (s.phaseDependency < 0 || s.phaseDependency > 7)
    issues.push(`phaseDependency ${s.phaseDependency} out of range 0-7`);
  if (!s.turns?.length) issues.push("at least one turn required");
  if (!s.expected) issues.push("expected block missing");
  if (
    !s.expected?.toolCalls?.length &&
    !s.expected?.responseContains?.length &&
    !s.expected?.judgeRubric
  ) {
    issues.push("expected block has no assertions (toolCalls/contains/rubric all empty)");
  }
  if (!s.baselineRationale) issues.push("baselineRationale required for honest baseline");
  return issues;
}

function buildReport(scenarios: EvalScenario[]): DryRunReport {
  const byPhase: Record<string, number> = {};
  const baselinePredictions = { pass: 0, partial: 0, fail: 0 };
  for (const s of scenarios) {
    byPhase[String(s.phaseDependency)] = (byPhase[String(s.phaseDependency)] ?? 0) + 1;
    baselinePredictions[s.baselinePrediction]++;
  }
  return {
    totalScenarios: scenarios.length,
    byPhase,
    runnableToday: scenarios.filter((s) => s.runnableToday).length,
    blockedByPhase: scenarios.filter((s) => !s.runnableToday).length,
    baselinePredictions,
    perScenario: scenarios.map((s) => ({
      name: s.name,
      title: s.title,
      phaseDependency: s.phaseDependency,
      runnableToday: s.runnableToday,
      baselinePrediction: s.baselinePrediction,
    })),
  };
}

function printReport(report: DryRunReport): void {
  console.log("\n=== Vitoria Eval Suite — Dry Run ===\n");
  console.log(`Total scenarios: ${report.totalScenarios}`);
  console.log(`Runnable today: ${report.runnableToday}`);
  console.log(`Blocked by future phases: ${report.blockedByPhase}`);
  console.log("\nBy phase dependency (G0-G7):");
  for (const [phase, count] of Object.entries(report.byPhase).sort()) {
    console.log(`  Phase G${phase}: ${count} scenario(s)`);
  }
  console.log("\nBaseline prediction (vs current Vitoria, pre-v2):");
  console.log(`  pass:    ${report.baselinePredictions.pass}`);
  console.log(`  partial: ${report.baselinePredictions.partial}`);
  console.log(`  fail:    ${report.baselinePredictions.fail}`);
  console.log("\nPer scenario:");
  for (const s of report.perScenario) {
    const flag = s.runnableToday ? "RUN" : `G${s.phaseDependency}`;
    const pad = s.name.padEnd(28);
    console.log(`  [${flag}] ${pad} ${s.baselinePrediction.padEnd(7)} ${s.title}`);
  }
  console.log("");
}

function parseArgs(argv: string[]): { caseFilter?: string; live: boolean } {
  const live = argv.includes("--live");
  const caseArg = argv.find((a) => a.startsWith("--case="));
  const caseFilter = caseArg ? caseArg.split("=")[1] : undefined;
  return { caseFilter, live };
}

function main(): void {
  const args = parseArgs(process.argv.slice(2));

  let hasIssues = false;
  for (const s of allScenarios) {
    const issues = validateScenario(s);
    if (issues.length) {
      hasIssues = true;
      console.error(`\n[INVALID] ${s.name}:`);
      issues.forEach((i) => console.error(`  - ${i}`));
    }
  }
  if (hasIssues) {
    console.error("\nFix invalid scenarios before running. Aborting.\n");
    process.exit(1);
  }

  const filtered = args.caseFilter
    ? allScenarios.filter((s) => s.name === args.caseFilter)
    : allScenarios;

  if (filtered.length === 0) {
    console.error(`No scenario matched filter "${args.caseFilter}".`);
    process.exit(1);
  }

  if (args.live) {
    console.error(
      "\n[--live not wired in v1]\n" +
        "Live mode lands as G1-G7 phases ship.\n" +
        "See src/eval/vitoria/README.md § Wire de --live.\n",
    );
    process.exit(2);
  }

  const report = buildReport(filtered);
  printReport(report);
  console.log(
    "Next steps:\n" +
      "  1. Read src/eval/vitoria/README.md for the harness contract.\n" +
      "  2. As each phase G1-G7 lands, the scenario(s) blocked on that phase\n" +
      "     become runnable — wire them in live mode then.\n" +
      "  3. BOSS gate target: ≥80% pass rate on the 10 scenarios.\n",
  );
}

main();
