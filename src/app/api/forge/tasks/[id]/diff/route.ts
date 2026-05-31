import { NextResponse } from "next/server";
import { getTask } from "@/lib/forge/dal/run";
import { execSync } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

export const dynamic = "force-dynamic";

type DiffResponse = {
  patch: string;
  files: string[];
};

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  try {
    const task = await getTask(id);

    if (!task) {
      return new NextResponse("Task not found", { status: 404 });
    }

    const meta = (task.meta as Record<string, unknown>) ?? {};
    const status = task.status;

    // For queued tasks, no diff available yet
    if (status === "queued") {
      return NextResponse.json<DiffResponse>({
        patch: "",
        files: [],
      });
    }

    let patch = "";
    let files: string[] = [];

    // For running tasks: diff from worktree
    if (status === "doing" || status === "todo" || status === "blocked") {
      const runId = task.runId;
      if (!runId) {
        return NextResponse.json<DiffResponse>({
          patch: "",
          files: [],
        });
      }

      const worktreePath = resolve(".forge", runId, "tasks", id, "worktree");

      if (existsSync(worktreePath)) {
        try {
          // Get diff against joao-dev branch
          patch = execSync("git diff joao-dev...HEAD", {
            cwd: worktreePath,
            encoding: "utf-8",
            stdio: ["pipe", "pipe", "pipe"],
          });

          // Extract changed files from diff
          const fileMatches = patch.matchAll(/^diff --git a\/(.*?) b\//gm);
          files = Array.from(fileMatches, (m) => m[1]);
        } catch (error) {
          console.error(`Failed to get diff for task ${id}:`, error);
        }
      }
    }
    // For done tasks: show commit diff
    else if (status === "done") {
      const commitSha = meta.commitSha;
      if (typeof commitSha === "string") {
        try {
          patch = execSync(`git show ${commitSha}`, {
            encoding: "utf-8",
            stdio: ["pipe", "pipe", "pipe"],
          });

          // Extract changed files from commit
          const fileMatches = patch.matchAll(/^diff --git a\/(.*?) b\//gm);
          files = Array.from(fileMatches, (m) => m[1]);
        } catch (error) {
          console.error(`Failed to get commit diff for task ${id}:`, error);
        }
      }
    }

    return NextResponse.json<DiffResponse>({
      patch,
      files,
    });
  } catch (error) {
    console.error(`Error getting diff for task ${id}:`, error);
    return new NextResponse("Internal Server Error", { status: 500 });
  }
}
