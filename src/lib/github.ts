// TODO: re-enable when GitHub integration is active
// import { Octokit } from "octokit";
// const octokit = new Octokit({ auth: process.env.GITHUB_TOKEN });
const octokit: any = null; // stub

export const github = {
  /**
   * Creates a GitHub issue for a task.
   * Returns the issue number.
   */
  async createIssue(
    owner: string,
    repo: string,
    title: string,
    body: string,
    labels: string[] = []
  ): Promise<number> {
    const { data } = await octokit.rest.issues.create({
      owner,
      repo,
      title,
      body,
      labels,
    });
    return data.number;
  },

  /**
   * Creates a branch from the default branch.
   * Returns the branch name.
   */
  async createBranch(
    owner: string,
    repo: string,
    baseBranch: string,
    branchName: string
  ): Promise<string> {
    // Get the SHA of the base branch
    const { data: ref } = await octokit.rest.git.getRef({
      owner,
      repo,
      ref: `heads/${baseBranch}`,
    });

    // Create the new branch
    await octokit.rest.git.createRef({
      owner,
      repo,
      ref: `refs/heads/${branchName}`,
      sha: ref.object.sha,
    });

    return branchName;
  },

  /**
   * Creates a pull request.
   * Returns { number, url }.
   */
  async createPullRequest(
    owner: string,
    repo: string,
    head: string,
    base: string,
    title: string,
    body: string
  ): Promise<{ number: number; url: string }> {
    const { data } = await octokit.rest.pulls.create({
      owner,
      repo,
      head,
      base,
      title,
      body,
    });
    return { number: data.number, url: data.html_url };
  },

  /**
   * Merges a pull request using squash merge.
   * Returns the merge commit SHA.
   */
  async mergePullRequest(
    owner: string,
    repo: string,
    prNumber: number,
    mergeMethod: "squash" | "merge" | "rebase" = "squash"
  ): Promise<string> {
    const { data } = await octokit.rest.pulls.merge({
      owner,
      repo,
      pull_number: prNumber,
      merge_method: mergeMethod,
    });
    return data.sha;
  },

  /**
   * Gets the status of a pull request.
   */
  async getPullRequestStatus(
    owner: string,
    repo: string,
    prNumber: number
  ): Promise<{
    state: string;
    mergeable: boolean | null;
    merged: boolean;
  }> {
    const { data } = await octokit.rest.pulls.get({
      owner,
      repo,
      pull_number: prNumber,
    });
    return {
      state: data.state,
      mergeable: data.mergeable,
      merged: data.merged,
    };
  },

  /**
   * Closes an issue.
   */
  async closeIssue(
    owner: string,
    repo: string,
    issueNumber: number
  ): Promise<void> {
    await octokit.rest.issues.update({
      owner,
      repo,
      issue_number: issueNumber,
      state: "closed",
    });
  },

  /**
   * Adds labels to an issue or PR.
   */
  async addLabels(
    owner: string,
    repo: string,
    issueNumber: number,
    labels: string[]
  ): Promise<void> {
    await octokit.rest.issues.addLabels({
      owner,
      repo,
      issue_number: issueNumber,
      labels,
    });
  },
};

/**
 * Generates a branch name from a task reference.
 * "TASK-001" → "task/TASK-001"
 */
export function taskBranchName(reference: string): string {
  return `task/${reference}`;
}

/**
 * Builds the issue body for a task.
 */
export function buildIssueBody(task: {
  title: string;
  description?: string | null;
  reference: string;
  complexity: string;
  scope: string;
  executionMode: string;
}): string {
  const lines = [
    `**Reference:** ${task.reference}`,
    `**Complexity:** ${task.complexity}`,
    `**Scope:** ${task.scope}`,
    `**Execution:** ${task.executionMode === "agent" ? "🤖 Agent" : "👤 Manual"}`,
    "",
  ];

  if (task.description) {
    lines.push("## Description", "", task.description);
  }

  return lines.join("\n");
}
