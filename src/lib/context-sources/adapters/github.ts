import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import { executeTool, getConnectionStatus } from "@/lib/composio/client";

type ContextSource = Database["public"]["Tables"]["ContextSource"]["Row"];

export interface ResolvedContent {
  fullText: string;
  snapshotAt: string;
}

/**
 * Exception thrown when member has no active Composio connection for GitHub.
 * Endpoint should catch this and return 412 Precondition Failed with connectUrl.
 */
export class ComposioConnectionMissing extends Error {
  constructor(
    public toolkit: string,
    public connectUrl?: string
  ) {
    super(`Composio connection missing for toolkit: ${toolkit}`);
    this.name = "ComposioConnectionMissing";
  }
}

/**
 * Parse GitHub URL to detect kind (repo | pr | issue) and extract metadata.
 * Supports: github.com/{owner}/{repo}, .../pull/{n}, .../issues/{n}
 */
function parseGitHubUrl(url: string): {
  kind: "github_repo" | "github_pr" | "github_issue";
  owner: string;
  repo: string;
  number?: number;
} | null {
  const match = url.match(
    /github\.com\/([^/]+)\/([^/]+?)(?:\/pull\/(\d+)|\/issues\/(\d+))?(?:\/|$)/
  );
  if (!match) return null;

  const [, owner, repo, prNum, issueNum] = match;
  if (prNum) {
    return { kind: "github_pr", owner, repo, number: parseInt(prNum, 10) };
  }
  if (issueNum) {
    return { kind: "github_issue", owner, repo, number: parseInt(issueNum, 10) };
  }
  return { kind: "github_repo", owner, repo };
}

/**
 * Resolve GitHub content via Composio GitHub toolkit.
 * Dispatches to GITHUB_GET_REPOSITORY_CONTENT, GET_PULL_REQUEST, or GET_AN_ISSUE.
 * Throws ComposioConnectionMissing if member has no active GitHub connection.
 */
export async function resolveContent(
  supabase: SupabaseClient<Database>,
  source: ContextSource
): Promise<ResolvedContent> {
  const url = source.externalId;
  if (!url) {
    throw new Error(`GitHub source ${source.id} missing externalId (URL)`);
  }

  if (!source.createdBy) {
    throw new Error(`GitHub source ${source.id} missing createdBy (member ID)`);
  }

  // Parse URL to detect kind
  const parsed = parseGitHubUrl(url);
  if (!parsed) {
    throw new Error(
      `Invalid GitHub URL: ${url}. Expected format: github.com/{owner}/{repo}[/pull/{n}|/issues/{n}]`
    );
  }

  // Check if member has active GitHub connection via Composio
  const connectionStatus = await getConnectionStatus(source.createdBy, "github");
  if (connectionStatus.status !== "active") {
    // Build connect URL for frontend to redirect user to OAuth flow
    const appUrl = process.env.APP_URL || "http://localhost:3000";
    const connectUrl = `${appUrl}/api/integrations/composio/connect?toolkit=github&redirect=${encodeURIComponent(url)}`;
    throw new ComposioConnectionMissing("github", connectUrl);
  }

  // Dispatch by kind
  let fullText: string;
  const snapshotAt = new Date().toISOString();

  if (parsed.kind === "github_repo") {
    // GITHUB_GET_REPOSITORY_CONTENT or similar (get README + metadata)
    const result = await executeTool(source.createdBy, "GITHUB_GET_REPOSITORY_CONTENT", {
      owner: parsed.owner,
      repo: parsed.repo,
      path: "README.md",
    });

    if (!result.ok) {
      throw new Error(`Failed to fetch GitHub repo ${url}: ${result.error}`);
    }

    const data = result.data as { content?: string; name?: string; message?: string };
    const readme = data.content
      ? Buffer.from(data.content, "base64").toString("utf-8")
      : "(No README found)";

    fullText = [
      `# ${parsed.owner}/${parsed.repo}`,
      "",
      `**Repository:** https://github.com/${parsed.owner}/${parsed.repo}`,
      "",
      "## README",
      "",
      readme,
    ].join("\n");
  } else if (parsed.kind === "github_pr") {
    // GITHUB_GET_PULL_REQUEST
    const result = await executeTool(source.createdBy, "GITHUB_GET_PULL_REQUEST", {
      owner: parsed.owner,
      repo: parsed.repo,
      pull_number: parsed.number!,
    });

    if (!result.ok) {
      throw new Error(`Failed to fetch GitHub PR ${url}: ${result.error}`);
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const pr = result.data as any;
    fullText = [
      `# PR #${parsed.number}: ${pr.title || "(No title)"}`,
      "",
      `**Repository:** ${parsed.owner}/${parsed.repo}`,
      `**State:** ${pr.state || "unknown"}`,
      `**Author:** ${pr.user?.login || "unknown"}`,
      `**URL:** ${url}`,
      "",
      "## Description",
      "",
      pr.body || "(No description)",
    ].join("\n");
  } else {
    // github_issue
    // GITHUB_GET_AN_ISSUE
    const result = await executeTool(source.createdBy, "GITHUB_GET_AN_ISSUE", {
      owner: parsed.owner,
      repo: parsed.repo,
      issue_number: parsed.number!,
    });

    if (!result.ok) {
      throw new Error(`Failed to fetch GitHub issue ${url}: ${result.error}`);
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const issue = result.data as any;
    fullText = [
      `# Issue #${parsed.number}: ${issue.title || "(No title)"}`,
      "",
      `**Repository:** ${parsed.owner}/${parsed.repo}`,
      `**State:** ${issue.state || "unknown"}`,
      `**Author:** ${issue.user?.login || "unknown"}`,
      `**URL:** ${url}`,
      "",
      "## Description",
      "",
      issue.body || "(No description)",
    ].join("\n");
  }

  return { fullText, snapshotAt };
}
