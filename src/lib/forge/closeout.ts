/**
 * Forge Closeout — Rito 4: merge branches + gh pr create + spec move
 *
 * Process:
 * 1. Validate all tasks have passes=true
 * 2. Merge task branches in topological order (respect dependsOn)
 * 3. Move spec from active/ to done/ with timestamp
 * 4. Push to all remotes (via sync-main.sh pattern)
 * 5. Create PR via gh CLI
 *
 * Constraints:
 * - All tasks must have passes=true (AC1)
 * - Branches merge to joao-dev, then final push to main
 * - Spec move preserves history (git mv equivalent)
 * - PR URL must be accessible via gh api (AC4)
 */

import "server-only";
import { execSync } from "node:child_process";
import { existsSync, renameSync, mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { getRunWithTasks, updateRunStatus, type ForgeRunRow, type ForgeTaskRow } from "./dal/run";
import type { Database } from "@/lib/supabase/database.types";

type ProjectRow = Database["public"]["Tables"]["Project"]["Row"];

export type CloseoutResult = {
  prUrl: string;
  mergedTasks: string[];
};

export type CloseoutOptions = {
  dryRun?: boolean;
  workspacePath?: string;
  project?: ProjectRow;
  prdSlug?: string;
};

/**
 * Execute closeout rito for a completed ForgeRun.
 *
 * AC1: Error if any task has passes=false
 * AC2: (implicit) All tasks must be merged
 * AC3: Spec moves to done/ with timestamp
 * AC4: PR URL is accessible via gh api
 *
 * Throws if validation fails or any step errors.
 */
export async function closeout(
  runId: string,
  options: CloseoutOptions = {},
): Promise<CloseoutResult> {
  const { dryRun = false, workspacePath, project, prdSlug } = options;

  // 1. Load run with tasks
  const runWithTasks = await getRunWithTasks(runId);
  if (!runWithTasks) {
    throw new Error(`Run ${runId} not found`);
  }

  const { tasks } = runWithTasks;
  const run = runWithTasks as ForgeRunRow;

  // 2. Validate all tasks have passes=true (AC2)
  const failedTasks = tasks.filter((task) => {
    const meta = (task.meta as Record<string, unknown>) ?? {};
    return meta.passes !== true;
  });

  if (failedTasks.length > 0) {
    const failedIds = failedTasks.map((t) => t.id).join(", ");
    throw new Error(
      `Cannot closeout: ${failedTasks.length} task(s) have not passed: ${failedIds}`,
    );
  }

  // 3. Build topological order for merges (respect dependsOn)
  const mergeOrder = topologicalSort(tasks);

  console.log(`→ Closeout for run ${runId}`);
  console.log(`  Tasks to merge: ${mergeOrder.length}`);

  const mergedTasks: string[] = [];

  if (!dryRun) {
    // 4. Merge branches in topological order
    for (const taskId of mergeOrder) {
      const task = tasks.find((t) => t.id === taskId);
      if (!task) continue;

      const branch = `forge/${runId}/${taskId}`;
      await mergeBranch(branch, taskId);
      mergedTasks.push(taskId);
    }

    // 5. Move spec from active/ to done/ with timestamp (AC3)
    const specId = (run as unknown as { specId?: string }).specId ?? "unknown-spec";
    await moveSpec(specId);

    // 6. Push to all remotes (joao-dev and main via sync-main.sh pattern)
    // For Forge, we push joao-dev to all remotes first
    await pushToRemotes("joao-dev");

    // 7. Create PR via gh CLI (AC4, AC5)
    const prUrl = await createPR(runId, specId, run, { workspacePath, project, prdSlug });

    // 8. Mark run as done
    await updateRunStatus(runId, "done", {
      endedAt: new Date().toISOString(),
    });

    return {
      prUrl,
      mergedTasks,
    };
  } else {
    // Dry run: just list what would happen
    console.log("\n→ Dry run: would execute the following:");
    console.log(`  1. Merge ${mergeOrder.length} branches in topological order`);
    for (const taskId of mergeOrder) {
      const task = tasks.find((t) => t.id === taskId);
      if (!task) continue;
      const branch = `forge/${runId}/${taskId}`;
      console.log(`     - ${branch}`);
    }

    const specId = (run as unknown as { specId?: string }).specId ?? "unknown-spec";
    console.log(`  2. Move spec: docs/specs/active/${specId}.md → docs/specs/done/${specId}-${timestamp()}.md`);
    console.log(`  3. Push joao-dev to all remotes`);
    console.log(`  4. Create PR for branch forge-${runId}`);
    console.log(`  5. Mark run ${runId} as done`);

    return {
      prUrl: "(dry-run)",
      mergedTasks: mergeOrder,
    };
  }
}

/**
 * Topological sort of tasks based on dependsOn.
 * Returns task IDs in order (dependencies before dependents).
 */
function topologicalSort(tasks: ForgeTaskRow[]): string[] {
  const graph = new Map<string, string[]>();
  const inDegree = new Map<string, number>();

  // Build graph
  for (const task of tasks) {
    graph.set(task.id, []);
    inDegree.set(task.id, 0);
  }

  for (const task of tasks) {
    const meta = (task.meta as Record<string, unknown>) ?? {};
    const deps = Array.isArray(meta.dependsOn) ? (meta.dependsOn as string[]) : [];

    for (const depId of deps) {
      if (graph.has(depId)) {
        graph.get(depId)!.push(task.id);
        inDegree.set(task.id, inDegree.get(task.id)! + 1);
      }
    }
  }

  // Kahn's algorithm
  const queue: string[] = [];
  for (const [id, degree] of inDegree.entries()) {
    if (degree === 0) {
      queue.push(id);
    }
  }

  const result: string[] = [];
  while (queue.length > 0) {
    const id = queue.shift()!;
    result.push(id);

    for (const neighbor of graph.get(id) ?? []) {
      const newDegree = inDegree.get(neighbor)! - 1;
      inDegree.set(neighbor, newDegree);
      if (newDegree === 0) {
        queue.push(neighbor);
      }
    }
  }

  // Check for cycles (shouldn't happen if DAG is valid)
  if (result.length !== tasks.length) {
    throw new Error("Circular dependency detected in task DAG");
  }

  return result;
}

/**
 * Merge a task branch to joao-dev.
 * Uses git merge --no-ff to preserve branch structure.
 */
async function mergeBranch(branch: string, taskId: string): Promise<void> {
  console.log(`→ Merging branch: ${branch}`);

  // Check if branch exists
  try {
    execSync(`git rev-parse --verify ${branch}`, { stdio: "pipe" });
  } catch {
    console.warn(`  Warning: branch ${branch} does not exist, skipping`);
    return;
  }

  // Checkout joao-dev
  execSync("git checkout joao-dev", { stdio: "pipe" });

  // Merge with --no-ff to preserve branch history
  try {
    execSync(`git merge --no-ff -m "forge: merge task ${taskId}" ${branch}`, {
      stdio: "pipe",
      encoding: "utf-8",
    });
    console.log(`✓ Merged ${branch}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to merge ${branch}: ${message}`);
  }

  // Delete branch after successful merge
  try {
    execSync(`git branch -d ${branch}`, { stdio: "pipe" });
    console.log(`✓ Deleted branch ${branch}`);
  } catch {
    // Branch might be in use or already deleted, continue
    console.warn(`  Warning: failed to delete branch ${branch}`);
  }
}

/**
 * Move spec from active/ to done/ with timestamp.
 * Creates done/ directory if it doesn't exist.
 */
async function moveSpec(specId: string): Promise<void> {
  const activePath = resolve("docs/specs/active", `${specId}.md`);
  const doneDir = resolve("docs/specs/done");
  const donePath = resolve(doneDir, `${specId}-${timestamp()}.md`);

  if (!existsSync(activePath)) {
    console.warn(`  Warning: spec not found at ${activePath}, skipping move`);
    return;
  }

  // Create done/ directory if needed
  mkdirSync(doneDir, { recursive: true });

  // Move file (preserves history if tracked by git)
  renameSync(activePath, donePath);
  console.log(`✓ Moved spec: ${activePath} → ${donePath}`);

  // Stage the move in git
  try {
    execSync(`git add ${activePath} ${donePath}`, { stdio: "pipe" });
  } catch {
    // File might not be tracked, continue
  }
}

/**
 * Push to all remotes using sync-main.sh pattern.
 * For Forge, we push the current branch (joao-dev) to all remotes.
 */
async function pushToRemotes(branch: string): Promise<void> {
  console.log(`→ Pushing ${branch} to all remotes...`);

  // Get list of remotes
  const remotesOutput = execSync("git remote", { encoding: "utf-8" });
  const remotes = remotesOutput.trim().split("\n").filter(Boolean);

  if (remotes.length === 0) {
    throw new Error("No remotes configured");
  }

  // Push to each remote
  for (const remote of remotes) {
    try {
      execSync(`git push ${remote} ${branch}`, {
        stdio: "pipe",
        encoding: "utf-8",
      });
      console.log(`✓ Pushed to ${remote}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Failed to push to ${remote}: ${message}`);
    }
  }
}

/**
 * Create PR via gh CLI.
 * Returns PR URL (AC4).
 *
 * If workspacePath/project/prdSlug provided (client mode):
 * - cd to workspacePath
 * - git push origin branch
 * - gh pr create --repo owner/repo --base defaultBranch --draft
 * - Use GH_TOKEN=pat if project.githubPat present
 *
 * Otherwise (dogfood mode):
 * - Create PR from current branch (joao-dev) to main in current repo
 */
async function createPR(
  runId: string,
  specId: string,
  run: ForgeRunRow,
  options: { workspacePath?: string; project?: ProjectRow; prdSlug?: string } = {},
): Promise<string> {
  const { workspacePath, project, prdSlug } = options;

  console.log("→ Creating PR via gh CLI...");

  const title = prdSlug ? `forge: ${prdSlug}` : `[Forge] ${specId}`;
  const body = buildPRBody(runId, specId, run);

  // Client mode: push to target repo and create PR there
  if (workspacePath && project && prdSlug) {
    return createClientPR(workspacePath, project, prdSlug, runId, title, body);
  }

  // Dogfood mode: create PR from joao-dev to main in current repo
  try {
    const output = execSync(
      `gh pr create --title "${title}" --body "${body.replace(/"/g, '\\"')}" --base main --head joao-dev`,
      {
        encoding: "utf-8",
        stdio: "pipe",
      },
    );

    // Extract PR URL from output (gh returns the URL on the last line)
    const prUrl = output.trim().split("\n").pop() ?? "";

    if (!prUrl.startsWith("http")) {
      throw new Error(`Invalid PR URL returned: ${prUrl}`);
    }

    console.log(`✓ PR created: ${prUrl}`);
    return prUrl;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to create PR: ${message}`);
  }
}

/**
 * Create PR in client repo (target workspace).
 *
 * AC2: git push origin branch
 * AC3: gh pr create --repo owner/repo --base defaultBranch
 * AC4: PR always --draft
 * AC5: Export GH_TOKEN if project.githubPat present
 * AC6: Return { prUrl } from stdout
 */
async function createClientPR(
  workspacePath: string,
  project: ProjectRow,
  prdSlug: string,
  runId: string,
  title: string,
  body: string,
): Promise<string> {
  console.log(`→ Creating PR in target repo: ${project.repoUrl}`);

  // Extract owner/repo from repoUrl
  // Supports: https://github.com/owner/repo.git, git@github.com:owner/repo.git
  const repoUrl = project.repoUrl ?? "";
  let ownerRepo = "";

  if (repoUrl.includes("github.com/")) {
    const match = repoUrl.match(/github\.com[/:]([^/]+\/[^/.]+)/);
    ownerRepo = match?.[1]?.replace(/\.git$/, "") ?? "";
  }

  if (!ownerRepo) {
    throw new Error(`Cannot extract owner/repo from repoUrl: ${repoUrl}`);
  }

  // Determine default branch (assume main, could query gh api later)
  const defaultBranch = "main";

  // Build branch name (from workspace.ts D3)
  const branch = `forge/${prdSlug}-${runId.slice(0, 8)}`;

  // AC2: Push branch to origin
  console.log(`→ Pushing branch ${branch} to origin...`);
  try {
    execSync(`git push origin "${branch}"`, {
      cwd: workspacePath,
      stdio: "pipe",
      encoding: "utf-8",
    });
    console.log(`✓ Pushed branch ${branch}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to push branch ${branch}: ${message}`);
  }

  // AC5: Build env with GH_TOKEN if PAT present
  const env = { ...process.env };
  if (project.githubPat) {
    env.GH_TOKEN = project.githubPat;
  }

  // AC3, AC4: Create PR with --repo, --base, --draft
  console.log(`→ Creating draft PR in ${ownerRepo}...`);
  try {
    const output = execSync(
      `gh pr create --repo "${ownerRepo}" --base "${defaultBranch}" --head "${branch}" --draft --title "${title}" --body "${body.replace(/"/g, '\\"')}"`,
      {
        cwd: workspacePath,
        encoding: "utf-8",
        stdio: "pipe",
        env,
      },
    );

    // AC6: Extract PR URL from stdout
    const prUrl = output.trim().split("\n").pop() ?? "";

    if (!prUrl.startsWith("http")) {
      throw new Error(`Invalid PR URL returned: ${prUrl}`);
    }

    console.log(`✓ Draft PR created: ${prUrl}`);
    return prUrl;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to create PR in ${ownerRepo}: ${message}`);
  }
}

/**
 * Build PR body with run metadata.
 */
function buildPRBody(runId: string, specId: string, run: ForgeRunRow): string {
  const costTotal = (run as unknown as { costUsdTotal?: number }).costUsdTotal ?? 0;

  return `## Forge Engine Auto-PR

**Run ID:** ${runId}
**Spec ID:** ${specId}
**Status:** ${run.status}
**Total Cost:** $${Number(costTotal).toFixed(2)}

This PR was automatically generated by the Forge Engine.

### Summary
- Tasks completed: ${run.progress ? Math.round(run.progress * 100) : 0}%
- Started: ${run.startedAt ? new Date(run.startedAt).toISOString() : "—"}
- Ended: ${run.endedAt ? new Date(run.endedAt).toISOString() : "—"}

### Review Checklist
- [ ] All acceptance criteria satisfied
- [ ] Verifiable checks passing
- [ ] No pivot required
- [ ] Cost within budget

---

🤖 Generated with [Forge Engine](https://forge.volund.dev)
`;
}

/**
 * Generate timestamp for spec filename (YYYYMMDD format).
 */
function timestamp(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}${month}${day}`;
}
