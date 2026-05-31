/**
 * Forge Workspace Management
 *
 * Manages git workspaces for Forge runs targeting external repos.
 *
 * Architecture:
 * - Workspace path: `.forge/<runId>/workspace/`
 * - Clone: shallow (--depth 1) for speed
 * - Branch: `forge/<prdSlug>-<runId-short>`
 * - PAT injection: via https://x-access-token:<pat>@github.com/... for private repos
 * - Lifecycle: created by ensureWorkspace, cleaned by gcStaleWorkspaces
 */

import { execSync } from "node:child_process";
import { existsSync, mkdirSync, rmSync, readdirSync, statSync } from "node:fs";
import { resolve } from "node:path";
import type { Database } from "@/lib/supabase/database.types";

type ProjectRow = Database["public"]["Tables"]["Project"]["Row"];

export type WorkspaceConfig = {
  runId: string;
  prdSlug: string;
  project: ProjectRow;
};

export type WorkspaceResult = {
  workspacePath: string;
  branch: string;
};

/**
 * Ensure workspace for a Forge run.
 *
 * Process:
 * 1. Validate project.repoUrl is not null/empty (fail early per D6)
 * 2. Create .forge/<runId>/workspace/ directory
 * 3. Clone project.repoUrl with --depth 1 (shallow, per D2)
 * 4. Inject PAT if present (D4) via https://x-access-token:<pat>@...
 * 5. Create branch forge/<prdSlug>-<runId-short> (D3)
 *
 * AC2: Fails early if project.repoUrl is null/empty
 * AC3: Branch name follows pattern forge/<prdSlug>-<runId-short>
 * AC4: Clone uses --depth 1 (shallow)
 * AC5: If PAT present, injected as Bearer in clone URL
 *
 * @throws Error if project.repoUrl is null/empty or git operations fail
 */
export function ensureWorkspace(config: WorkspaceConfig): WorkspaceResult {
  const { runId, prdSlug, project } = config;

  // AC2: Fail early if project.repoUrl is null/empty
  if (!project.repoUrl || project.repoUrl.trim() === "") {
    throw new Error(
      `Project ${project.id} (${project.name}) has no repoUrl configured. ` +
        `Cannot create workspace for Forge run.`,
    );
  }

  const forgeRoot = resolve(process.cwd(), ".forge");
  const runRoot = resolve(forgeRoot, runId);
  const workspacePath = resolve(runRoot, "workspace");

  // If workspace already exists, return early (idempotent)
  if (existsSync(workspacePath)) {
    const branch = `forge/${prdSlug}-${shortId(runId)}`;
    return { workspacePath, branch };
  }

  // Create workspace directory
  mkdirSync(workspacePath, { recursive: true });

  // Build clone URL with PAT injection if available (AC5)
  const cloneUrl = buildCloneUrl(project.repoUrl, project.githubPat);

  // AC4: Clone with --depth 1 (shallow)
  try {
    execSync(`git clone --depth 1 "${cloneUrl}" "${workspacePath}"`, {
      stdio: "pipe",
      encoding: "utf-8",
    });
  } catch (error) {
    // Clean up partial workspace on failure
    if (existsSync(workspacePath)) {
      rmSync(workspacePath, { recursive: true, force: true });
    }

    const message = error instanceof Error ? error.message : String(error);
    throw new Error(
      `Failed to clone ${project.repoUrl} into workspace: ${message}`,
    );
  }

  // AC3: Create branch forge/<prdSlug>-<runId-short>
  const branch = `forge/${prdSlug}-${shortId(runId)}`;
  try {
    execSync(`git checkout -b "${branch}"`, {
      cwd: workspacePath,
      stdio: "pipe",
      encoding: "utf-8",
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to create branch ${branch}: ${message}`);
  }

  return { workspacePath, branch };
}

/**
 * Teardown workspace for a Forge run.
 *
 * Removes `.forge/<runId>/workspace/` directory.
 * Safe to call multiple times (idempotent).
 */
export function teardownWorkspace(runId: string): void {
  const workspacePath = resolve(process.cwd(), ".forge", runId, "workspace");

  if (!existsSync(workspacePath)) {
    return; // Already gone, idempotent
  }

  try {
    rmSync(workspacePath, { recursive: true, force: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to remove workspace ${workspacePath}: ${message}`);
  }
}

/**
 * Garbage collect stale workspaces.
 *
 * Removes workspaces older than maxAgeHours (default 24h per D8).
 *
 * Process:
 * 1. List all runId dirs in .forge/
 * 2. For each, check if workspace/ exists
 * 3. If workspace/ mtime > maxAgeHours, remove it
 *
 * @param maxAgeHours Default 24 (D8: preserve 24h after run, then gc)
 * @returns Array of runIds whose workspaces were removed
 */
export function gcStaleWorkspaces(maxAgeHours = 24): string[] {
  const forgeRoot = resolve(process.cwd(), ".forge");

  if (!existsSync(forgeRoot)) {
    return []; // Nothing to gc
  }

  const now = Date.now();
  const maxAgeMs = maxAgeHours * 60 * 60 * 1000;
  const removed: string[] = [];

  try {
    const runDirs = readdirSync(forgeRoot, { withFileTypes: true }).filter(
      (dirent) => dirent.isDirectory(),
    );

    for (const dirent of runDirs) {
      const runId = dirent.name;
      const workspacePath = resolve(forgeRoot, runId, "workspace");

      if (!existsSync(workspacePath)) {
        continue; // No workspace to gc
      }

      const stats = statSync(workspacePath);
      const ageMs = now - stats.mtimeMs;

      if (ageMs > maxAgeMs) {
        rmSync(workspacePath, { recursive: true, force: true });
        removed.push(runId);
      }
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to gc stale workspaces: ${message}`);
  }

  return removed;
}

/**
 * Build clone URL with optional PAT injection.
 *
 * If PAT is present and URL is github.com, inject as:
 * https://x-access-token:<pat>@github.com/owner/repo.git
 *
 * Per D5: PAT injection enables private repo access.
 */
function buildCloneUrl(repoUrl: string, pat: string | null): string {
  if (!pat) {
    return repoUrl; // No PAT, use URL as-is
  }

  // Only inject PAT for GitHub URLs (safety)
  if (!repoUrl.includes("github.com")) {
    return repoUrl;
  }

  // Handle both https:// and git@ formats
  if (repoUrl.startsWith("https://")) {
    // https://github.com/owner/repo.git → https://x-access-token:PAT@github.com/owner/repo.git
    return repoUrl.replace("https://", `https://x-access-token:${pat}@`);
  } else if (repoUrl.startsWith("git@")) {
    // git@github.com:owner/repo.git → https://x-access-token:PAT@github.com/owner/repo.git
    const withoutPrefix = repoUrl.replace("git@github.com:", "");
    return `https://x-access-token:${pat}@github.com/${withoutPrefix}`;
  }

  // Fallback: URL doesn't match expected format, return as-is
  return repoUrl;
}

/**
 * Get short ID (first 8 chars of UUID).
 * Per D3: branch name uses runId-short for readability.
 */
function shortId(uuid: string): string {
  return uuid.slice(0, 8);
}
