import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { getUser } from "@/lib/dal";
import { canViewProject } from "@/lib/dal";

export const dynamic = "force-dynamic";

const bodySchema = z.object({
  taskId: z.string(),
});

/**
 * POST /api/forge/runs
 * Spawns a detached Forge orchestrator process for a given taskId.
 * Only available in development mode.
 *
 * Validates:
 * - User is authenticated
 * - Task exists
 * - User has access to the task's project
 *
 * Returns: { runId: string }
 */
export async function POST(req: Request) {
  if (process.env.NODE_ENV === "production") {
    return new NextResponse(null, { status: 404 });
  }

  // Auth check
  const user = await getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Parse body
  const parsed = bodySchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Missing or invalid taskId" },
      { status: 400 }
    );
  }

  const { taskId } = parsed.data;

  // Fetch task to validate ownership
  const { data: task } = await db()
    .from("Task")
    .select("id, projectId")
    .eq("id", taskId)
    .maybeSingle();

  if (!task) {
    return NextResponse.json({ error: "Task not found" }, { status: 404 });
  }

  // Check project access
  const hasAccess = await canViewProject(task.projectId);
  if (!hasAccess) {
    return NextResponse.json(
      { error: "No access to this task's project" },
      { status: 403 }
    );
  }

  const runId = randomUUID();
  const repoRoot = process.cwd();
  const script = resolve(repoRoot, "scripts/forge/exec-spike.ts");

  // Spawn detached so it survives Next.js dev server reload.
  // stdio ignored so child has no parent pipes keeping it alive in our process tree.
  const child = spawn("npx", ["tsx", script, runId, taskId], {
    cwd: repoRoot,
    detached: true,
    stdio: "ignore",
    env: process.env,
  });
  child.unref();

  return NextResponse.json({
    runId,
    pid: child.pid,
    startedAt: new Date().toISOString(),
  });
}
