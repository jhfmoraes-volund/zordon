#!/usr/bin/env tsx
/**
 * Forge CLI — command-line interface for Forge Engine operations.
 *
 * Subcommands:
 * - spec validate <path>  — validate a spec.md file
 * - init <slug>           — initialize a new ForgeRun from spec
 * - plan <slug>           — generate execution plan from spec
 * - run <slug>            — execute ForgeRun with orchestrator
 * - ps                    — list active ForgeRuns with progress
 * - kill <runId>          — abort a running ForgeRun
 * - done <runId>          — create PR for completed run
 *
 * Usage: tsx scripts/forge/cli.ts <subcommand> [args...]
 *        OR (if bin configured): forge <subcommand> [args...]
 */
import "dotenv/config";
import { validateSpec } from "../../src/lib/forge/spec/validator";
import { plan } from "../../src/lib/forge/planner";
import { resolve } from "node:path";
import { writeFileSync, mkdirSync } from "node:fs";

// ── Colors ────────────────────────────────────────────────────────────────
const dim = (s: string) => `\x1b[2m${s}\x1b[0m`;
const yellow = (s: string) => `\x1b[33m${s}\x1b[0m`;
const cyan = (s: string) => `\x1b[36m${s}\x1b[0m`;
const green = (s: string) => `\x1b[32m${s}\x1b[0m`;
const red = (s: string) => `\x1b[31m${s}\x1b[0m`;

// ── Help ──────────────────────────────────────────────────────────────────
function showHelp() {
  console.log("usage: forge <subcommand> [args...]");
  console.log("");
  console.log("subcommands:");
  console.log("  spec validate <path>         — validate a spec.md file");
  console.log("  init <slug> [--project ID]   — initialize ForgeRun from spec");
  console.log("  plan <slug>                  — generate execution plan from spec");
  console.log("  run <slug> [--dry-run] [--project ID]  — execute ForgeRun with orchestrator");
  console.log("  ps                           — list active ForgeRuns with progress");
  console.log("  kill <runId>                 — abort a running ForgeRun");
  console.log("  done <runId>                 — create PR for completed run");
  console.log("");
  console.log("options:");
  console.log("  --help, -h                   — show help for a subcommand");
  console.log("  --project <projectId>        — associate run with a Project (UUID)");
  console.log("");
  console.log("examples:");
  console.log("  forge spec validate docs/specs/active/my-feature.md");
  console.log("  forge plan my-feature");
  console.log("  forge init my-feature --project abc-123");
  console.log("  forge run my-feature --dry-run --project abc-123");
  console.log("  forge ps");
  console.log("  forge kill run-12345");
  console.log("  forge done run-12345");
}

// ── Argument parsing ──────────────────────────────────────────────────────
const [, , subcommand, ...args] = process.argv;

if (!subcommand || subcommand === "--help" || subcommand === "-h") {
  showHelp();
  process.exit(subcommand ? 0 : 64);
}

// ── spec validate ─────────────────────────────────────────────────────────

if (subcommand === "spec" && args[0] === "validate") {
  if (args.includes("--help") || args.includes("-h")) {
    console.log("usage: forge spec validate <path>");
    console.log("");
    console.log("Validates a spec.md file against the Forge spec schema.");
    console.log("");
    console.log("examples:");
    console.log("  forge spec validate docs/specs/active/my-feature.md");
    process.exit(0);
  }

  const specPath = args[1];

  if (!specPath) {
    console.error("usage: forge spec validate <path>");
    process.exit(64);
  }

  const absolutePath = resolve(process.cwd(), specPath);
  const result = validateSpec(absolutePath);

  if (result.ok) {
    console.log(green("✓ Spec is valid"));
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
    console.error(red("✗ Spec validation failed"));
    console.error("");
    for (const error of result.errors) {
      const location = error.line > 0 ? `${error.line}:${error.column}` : "(unknown)";
      const section = error.section ? `[${error.section}] ` : "";
      console.error(`  ${location} ${section}${error.message}`);
    }
    process.exit(1);
  }
}

// ── init ──────────────────────────────────────────────────────────────────

else if (subcommand === "init") {
  if (args.includes("--help") || args.includes("-h")) {
    console.log("usage: forge init <slug> [--project <projectId>]");
    console.log("");
    console.log("Initialize a new ForgeRun from a validated spec.");
    console.log("Creates ForgeRun and ForgeTask records in Supabase.");
    console.log("");
    console.log("options:");
    console.log("  --project <projectId>   — associate run with a Project (UUID)");
    console.log("");
    console.log("examples:");
    console.log("  forge init my-feature");
    console.log("  forge init my-feature --project abc-123");
    process.exit(0);
  }

  const slug = args.filter(a => !a.startsWith("--"))[0];
  const projectIdIdx = args.indexOf("--project");
  const projectId = projectIdIdx >= 0 && args[projectIdIdx + 1] ? args[projectIdIdx + 1] : null;

  if (!slug) {
    console.error("usage: forge init <slug> [--project <projectId>]");
    console.error("");
    console.error("examples:");
    console.error("  forge init my-feature");
    console.error("  forge init my-feature --project abc-123");
    process.exit(64);
  }

  (async () => {
    try {
      const { createRun, createTasks } = await import("../../src/lib/forge/dal/run");

      // Resolve spec path
      let specPath = `docs/specs/active/${slug}.md`;
      if (slug.includes("/") || slug.endsWith(".md")) {
        specPath = slug;
      }

      const absoluteSpecPath = resolve(process.cwd(), specPath);

      console.log(yellow(`→ Initializing ForgeRun for ${specPath}...`));

      // Validate spec first
      const validationResult = validateSpec(absoluteSpecPath);
      if (!validationResult.ok) {
        console.error(red("✗ Spec validation failed"));
        for (const error of validationResult.errors) {
          console.error(`  ${error.message}`);
        }
        process.exit(1);
      }

      // Generate plan
      console.log(yellow("→ Generating plan..."));
      const planResult = await plan(absoluteSpecPath);

      // Create ForgeRun (use provided projectId or stub)
      const finalProjectId = projectId ?? "00000000-0000-0000-0000-000000000000";
      const run = await createRun({
        specId: slug as any, // FIXME: database.types.ts needs regeneration after migration
        status: "queued",
        progress: 0,
        projectId: finalProjectId, // Real projectId if --project passed, else stub
        ownerId: "00000000-0000-0000-0000-000000000000", // Stub — replace with actual ownerId from context
        title: `Forge run: ${slug}`,
        trigger: "ad_hoc",
      } as any); // FIXME: database.types.ts needs regeneration after migration

      console.log(green(`✓ Created ForgeRun: ${run.id}`));
      if (projectId) {
        console.log(dim(`  Project: ${projectId}`));
      }

      // Create ForgeTasks
      const taskInserts = planResult.stories.map((story, idx) => ({
        runId: run.id,
        projectId: run.projectId, // Same as run
        agentProfile: story.agentProfile ?? "wiring",
        title: story.title,
        ord: idx,
        status: "queued" as const,
        progress: 0,
        meta: {
          description: story.description,
          acceptanceCriteria: story.acceptanceCriteria,
          verifiable: story.verifiable,
          dependsOn: story.dependsOn ?? [],
          estimateMinutes: story.estimateMinutes,
          touches: story.touches,
        },
      }));

      const tasks = await createTasks(taskInserts);
      console.log(green(`✓ Created ${tasks.length} ForgeTasks`));
      console.log("");
      console.log(`  Run ID: ${run.id}`);
      console.log(`  Spec: ${specPath}`);
      console.log(`  Tasks: ${tasks.length}`);
      console.log("");
      console.log(dim(`Next: forge run ${slug}`));

      process.exit(0);
    } catch (err: unknown) {
      console.error(red("✗ Initialization failed"));
      console.error("");
      console.error(`  ${err instanceof Error ? err.message : String(err)}`);
      process.exit(1);
    }
  })();
}

// ── plan ──────────────────────────────────────────────────────────────────

else if (subcommand === "plan") {
  if (args.includes("--help") || args.includes("-h")) {
    console.log("usage: forge plan <slug>");
    console.log("");
    console.log("Generate execution plan from spec (writes .forge/<slug>/plan.jsonl).");
    console.log("");
    console.log("examples:");
    console.log("  forge plan example          — plan from docs/specs/example.md");
    console.log("  forge plan my-feature       — plan from docs/specs/active/my-feature.md");
    process.exit(0);
  }

  const slug = args[0];

  if (!slug) {
    console.error("usage: forge plan <slug>");
    console.error("");
    console.error("examples:");
    console.error("  forge plan example          — plan from docs/specs/example.md");
    console.error("  forge plan my-feature       — plan from docs/specs/active/my-feature.md");
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
      console.log(yellow(`→ Planning from ${specPath}...`));
      const result = await plan(absoluteSpecPath);

      // Write to .forge/<slug>/plan.jsonl
      const forgeDir = `.forge/${slug}`;
      mkdirSync(forgeDir, { recursive: true });

      const planPath = `${forgeDir}/plan.jsonl`;
      const jsonlContent = result.stories.map(s => JSON.stringify(s)).join("\n");
      writeFileSync(planPath, jsonlContent);

      console.log(green("✓ Plan generated"));
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
    } catch (err: unknown) {
      console.error(red("✗ Planning failed"));
      console.error("");
      console.error(`  ${err instanceof Error ? err.message : String(err)}`);
      process.exit(1);
    }
  })();
}

// ── run ───────────────────────────────────────────────────────────────────

else if (subcommand === "run") {
  if (args.includes("--help") || args.includes("-h")) {
    console.log("usage: forge run <slug> [--dry-run] [--project <projectId>]");
    console.log("");
    console.log("Execute ForgeRun with orchestrator.");
    console.log("");
    console.log("options:");
    console.log("  --dry-run               — list tasks without executing");
    console.log("  --project <projectId>   — associate run with a Project (UUID)");
    console.log("");
    console.log("examples:");
    console.log("  forge run example                        — execute ForgeRun for example spec");
    console.log("  forge run example --dry-run              — list tasks without executing");
    console.log("  forge run example --project abc-123      — execute with project context");
    process.exit(0);
  }

  const slug = args.filter(a => !a.startsWith("--"))[0];
  const dryRunFlag = args.includes("--dry-run");
  const projectIdIdx = args.indexOf("--project");
  const projectId = projectIdIdx >= 0 && args[projectIdIdx + 1] ? args[projectIdIdx + 1] : null;

  if (!slug) {
    console.error("usage: forge run <slug> [--dry-run] [--project <projectId>]");
    console.error("");
    console.error("examples:");
    console.error("  forge run example                        — execute ForgeRun for example spec");
    console.error("  forge run example --dry-run              — list tasks without executing");
    console.error("  forge run example --project abc-123      — execute with project context");
    process.exit(64);
  }

  (async () => {
    try {
      const { runOrchestrator } = await import("../../src/lib/forge/orchestrator");

      console.log(yellow(`→ Running orchestrator for spec: ${slug}${dryRunFlag ? ' (dry-run)' : ''}${projectId ? ` (project: ${projectId})` : ''}...`));

      // In a real implementation, we'd look up the runId from ForgeRun table by specId
      // For now, use slug as both specId and runId (type widening in orchestrator handles this)
      const result = await runOrchestrator({
        specId: slug,
        maxConcurrency: 3,
        dryRun: dryRunFlag,
        projectId: projectId ?? undefined,
      } as Parameters<typeof runOrchestrator>[0]);

      if (dryRunFlag) {
        console.log(green("✓ Dry run completed"));
        process.exit(0);
      }

      console.log(green("✓ Orchestrator completed"));
      console.log("");
      console.log(`  Status: ${result.status}`);
      console.log(`  Tasks completed: ${result.tasksCompleted}`);
      console.log(`  Tasks failed: ${result.tasksFailed}`);
      if (result.pivotRequired) {
        console.log(yellow(`  ⚠ Pivot required: ${result.pivotReportPath}`));
      }

      process.exit(result.status === "done" ? 0 : 1);
    } catch (err: unknown) {
      console.error(red("✗ Orchestrator failed"));
      console.error("");
      console.error(`  ${err instanceof Error ? err.message : String(err)}`);
      process.exit(1);
    }
  })();
}

// ── ps ────────────────────────────────────────────────────────────────────

else if (subcommand === "ps") {
  if (args.includes("--help") || args.includes("-h")) {
    console.log("usage: forge ps [--target]");
    console.log("");
    console.log("List active ForgeRuns with progress, cost, ETA, and target repo.");
    console.log("");
    console.log("options:");
    console.log("  --target    — show Target column (repo owner/name or (zordon))");
    console.log("");
    console.log("examples:");
    console.log("  forge ps");
    console.log("  forge ps --target");
    process.exit(0);
  }

  const showTarget = args.includes("--target");

  (async () => {
    try {
      const { db } = await import("../../src/lib/db");

      const { data: runs, error } = await db()
        .from("ForgeRun")
        .select("id, specId, status, progress, startedAt, endedAt, costUsdTotal, projectId, Project(repoUrl)")
        .order("createdAt", { ascending: false })
        .limit(20);

      if (error) throw error;

      if (!runs || runs.length === 0) {
        console.log(dim("No ForgeRuns found"));
        process.exit(0);
      }

      console.log("");
      console.log(cyan("═══ Active ForgeRuns ═══"));
      console.log("");

      // Table header
      const headerCols = [
        "ID".padEnd(12),
        "Spec".padEnd(20),
        "Status".padEnd(15),
        "Progress".padEnd(10),
        "Cost".padEnd(8),
        "ETA".padEnd(10),
      ];

      if (showTarget) {
        headerCols.push("Target".padEnd(25));
      }

      const header = headerCols.join(" │ ");
      console.log(dim(header));
      console.log(dim("─".repeat(header.length)));

      // Table rows
      for (const run of runs) {
        const id = run.id.slice(0, 12).padEnd(12);
        const spec = (run.specId ?? "—").slice(0, 20).padEnd(20);
        const status = (run.status ?? "—").padEnd(15);
        const progress = `${Math.round((run.progress ?? 0))}%`.padEnd(10);
        const cost = `$${Number(run.costUsdTotal ?? 0).toFixed(2)}`.padEnd(8);

        // Calculate ETA (naive: assume linear progress)
        let eta = "—";
        if (run.startedAt && run.status === "running" && run.progress && run.progress > 0) {
          const elapsed = Date.now() - new Date(run.startedAt).getTime();
          const total = elapsed / run.progress;
          const remaining = total - elapsed;
          const minutes = Math.round(remaining / 60000);
          eta = minutes > 0 ? `${minutes}m` : "soon";
        }
        eta = eta.padEnd(10);

        const rowCols = [id, spec, status, progress, cost, eta];

        if (showTarget) {
          // Derive target from Project.repoUrl
          let target = "(zordon)";
          const stubProjectId = "00000000-0000-0000-0000-000000000000";

          if (run.projectId !== stubProjectId && run.Project && (run.Project as any).repoUrl) {
            const repoUrl = (run.Project as any).repoUrl as string;
            // Extract owner/repo from URL like https://github.com/owner/repo.git or git@github.com:owner/repo.git
            const match = repoUrl.match(/github\.com[:/]([^/]+\/[^/.]+)/);
            if (match) {
              target = match[1].replace(/\.git$/, "");
            }
          }

          rowCols.push(target.slice(0, 25).padEnd(25));
        }

        console.log(rowCols.join(" │ "));
      }

      console.log("");
      process.exit(0);
    } catch (err: unknown) {
      console.error(red("✗ Failed to list runs"));
      console.error("");
      console.error(`  ${err instanceof Error ? err.message : String(err)}`);
      process.exit(1);
    }
  })();
}

// ── kill ──────────────────────────────────────────────────────────────────

else if (subcommand === "kill") {
  if (args.includes("--help") || args.includes("-h")) {
    console.log("usage: forge kill <runId>");
    console.log("");
    console.log("Abort a running ForgeRun (sends SIGTERM to orchestrator).");
    console.log("");
    console.log("examples:");
    console.log("  forge kill run-12345");
    process.exit(0);
  }

  const runId = args[0];

  if (!runId) {
    console.error("usage: forge kill <runId>");
    console.error("");
    console.error("examples:");
    console.error("  forge kill run-12345");
    process.exit(64);
  }

  (async () => {
    try {
      const { readFileSync, existsSync } = await import("node:fs");
      const { resolve } = await import("node:path");

      const pidLockPath = resolve(".forge", runId, "orchestrator.pid");

      if (!existsSync(pidLockPath)) {
        console.error(red(`✗ No running orchestrator found for run ${runId}`));
        process.exit(1);
      }

      const pid = parseInt(readFileSync(pidLockPath, "utf-8").trim(), 10);

      console.log(yellow(`→ Sending SIGTERM to orchestrator (PID ${pid})...`));
      process.kill(pid, "SIGTERM");

      console.log(green("✓ Shutdown signal sent"));
      console.log("");
      console.log(dim("  The orchestrator will complete active workers and exit gracefully."));

      process.exit(0);
    } catch (err: unknown) {
      console.error(red("✗ Failed to kill orchestrator"));
      console.error("");
      if (err instanceof Error && "code" in err && err.code === "ESRCH") {
        console.error("  Process not found (may have already exited)");
      } else {
        console.error(`  ${err instanceof Error ? err.message : String(err)}`);
      }
      process.exit(1);
    }
  })();
}

// ── done ──────────────────────────────────────────────────────────────────

else if (subcommand === "done") {
  if (args.includes("--help") || args.includes("-h")) {
    console.log("usage: forge done <runId> [--dry-run]");
    console.log("");
    console.log("Execute closeout rito for a completed ForgeRun:");
    console.log("  - Validate all tasks have passes=true");
    console.log("  - Merge task branches in topological order");
    console.log("  - Move spec from active/ to done/");
    console.log("  - Push to all remotes");
    console.log("  - Create PR via gh CLI");
    console.log("");
    console.log("options:");
    console.log("  --dry-run    — list actions without executing");
    console.log("");
    console.log("examples:");
    console.log("  forge done run-12345              — execute closeout");
    console.log("  forge done run-12345 --dry-run    — preview actions");
    process.exit(0);
  }

  const runId = args[0];
  const dryRunFlag = args.includes("--dry-run");

  if (!runId) {
    console.error("usage: forge done <runId> [--dry-run]");
    console.error("");
    console.error("examples:");
    console.error("  forge done run-12345              — execute closeout");
    console.error("  forge done run-12345 --dry-run    — preview actions");
    process.exit(64);
  }

  (async () => {
    try {
      const { closeout } = await import("../../src/lib/forge/closeout");

      console.log(yellow(`→ Executing closeout for run ${runId}${dryRunFlag ? ' (dry-run)' : ''}...`));

      const result = await closeout(runId, { dryRun: dryRunFlag });

      console.log(green("✓ Closeout completed"));
      console.log("");
      console.log(`  PR URL: ${result.prUrl}`);
      console.log(`  Merged tasks: ${result.mergedTasks.length}`);
      if (!dryRunFlag) {
        console.log("");
        console.log("  Next steps:");
        console.log("  1. Review the PR");
        console.log("  2. Merge when ready");
        console.log("  3. Spec moved to docs/specs/done/");
      }

      process.exit(0);
    } catch (err: unknown) {
      console.error(red("✗ Closeout failed"));
      console.error("");
      console.error(`  ${err instanceof Error ? err.message : String(err)}`);
      process.exit(1);
    }
  })();
}

// ── unknown subcommand ────────────────────────────────────────────────────

else {
  console.error(red(`unknown subcommand: ${subcommand}`));
  console.error("");
  console.error("Run 'forge --help' to see available commands.");
  process.exit(64);
}
