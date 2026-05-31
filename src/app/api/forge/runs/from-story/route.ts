import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  if (process.env.NODE_ENV === "production") {
    return new NextResponse(null, { status: 404 });
  }

  let prdSlug: string;
  let storyId: string;
  try {
    const body = await req.json();
    prdSlug = String(body?.prdSlug ?? "");
    storyId = String(body?.storyId ?? "");
  } catch {
    return NextResponse.json({ error: "invalid json body" }, { status: 400 });
  }

  if (!prdSlug || !storyId) {
    return NextResponse.json(
      { error: "prdSlug and storyId required" },
      { status: 400 },
    );
  }

  const runId = randomUUID();
  const repoRoot = process.cwd();
  const script = resolve(repoRoot, "scripts/forge/exec-story.ts");

  const child = spawn("npx", ["tsx", script, runId, prdSlug, storyId], {
    cwd: repoRoot,
    detached: true,
    stdio: "ignore",
    env: process.env,
  });
  child.unref();

  return NextResponse.json({
    runId,
    prdSlug,
    storyId,
    pid: child.pid,
    startedAt: new Date().toISOString(),
  });
}
