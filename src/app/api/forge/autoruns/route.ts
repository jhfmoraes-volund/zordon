import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { NextResponse } from "next/server";
import { movePrd } from "@/lib/forge/prd-fs";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  if (process.env.NODE_ENV === "production") {
    return new NextResponse(null, { status: 404 });
  }

  let prdSlug: string;
  let maxStories = 20;
  let projectId: string | undefined;
  try {
    const body = await req.json();
    prdSlug = String(body?.prdSlug ?? "");
    if (typeof body?.maxStories === "number") maxStories = body.maxStories;
    if (body?.projectId && typeof body.projectId === "string") {
      projectId = body.projectId;
    }
  } catch {
    return NextResponse.json({ error: "invalid json body" }, { status: 400 });
  }

  if (!prdSlug) {
    return NextResponse.json({ error: "prdSlug required" }, { status: 400 });
  }

  const autorunId = randomUUID();
  const repoRoot = process.cwd();
  const script = resolve(repoRoot, "scripts/forge/exec-prd.ts");

  // Move PRD to in-progress/ BEFORE spawning so kanban reflects immediately.
  // Filesystem-as-state: state IS the parent directory.
  let move: Awaited<ReturnType<typeof movePrd>> = null;
  try {
    move = await movePrd(prdSlug, "in-progress");
  } catch (err) {
    console.error("autoruns: failed to move PRD to in-progress", err);
  }

  // Build args: autorunId, prdSlug, maxStories, [projectId]
  const args = ["tsx", script, autorunId, prdSlug, String(maxStories)];
  if (projectId) {
    args.push(projectId);
  }

  const child = spawn("npx", args, {
    cwd: repoRoot,
    detached: true,
    stdio: "ignore",
    env: process.env,
  });
  child.unref();

  return NextResponse.json({
    autorunId,
    prdSlug,
    maxStories,
    projectId,
    pid: child.pid,
    startedAt: new Date().toISOString(),
    stateMove: move,
  });
}
