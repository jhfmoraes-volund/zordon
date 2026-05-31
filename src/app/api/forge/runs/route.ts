import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  if (process.env.NODE_ENV === "production") {
    return new NextResponse(null, { status: 404 });
  }

  let taskId = "spike-task";
  try {
    const body = await req.json();
    if (typeof body?.taskId === "string") taskId = body.taskId;
  } catch {
    // No body or invalid JSON — use default
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
    taskId,
    pid: child.pid,
    startedAt: new Date().toISOString(),
  });
}
