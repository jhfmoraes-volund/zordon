import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

type AutorunEvent = {
  kind: string;
  seq?: number;
  ts?: string;
  payload?: Record<string, unknown>;
};

type MemoryEntry = {
  story: string;
  title: string;
  passes: boolean;
  summary: string;
  filesTouched: string[];
  durationMs: number;
  totalEvents: number;
  exitCode: number | null;
};

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  if (process.env.NODE_ENV === "production") {
    return new NextResponse(null, { status: 404 });
  }

  const { id: autorunId } = await params;
  const dir = resolve(process.cwd(), ".forge", autorunId);
  const eventsPath = resolve(dir, "events.jsonl");
  const memoryPath = resolve(dir, "memory.jsonl");

  if (!existsSync(eventsPath)) {
    return NextResponse.json({ error: "autorun not found", autorunId }, { status: 404 });
  }

  // Read events
  let events: AutorunEvent[] = [];
  try {
    const lines = readFileSync(eventsPath, "utf-8")
      .split("\n")
      .filter((l) => l.trim());
    events = lines.map((l) => JSON.parse(l));
  } catch {
    // best effort
  }

  // Read memory
  let memory: MemoryEntry[] = [];
  if (existsSync(memoryPath)) {
    try {
      const lines = readFileSync(memoryPath, "utf-8")
        .split("\n")
        .filter((l) => l.trim());
      memory = lines.map((l) => JSON.parse(l));
    } catch {
      // best effort
    }
  }

  // Derive status
  const startedEv = events.find((e) => e.kind === "autorun_started");
  const doneEv = [...events].reverse().find((e) => e.kind === "autorun_done");
  const pivotEv = events.find((e) => e.kind === "autorun_pivot");

  let status: "running" | "done" | "failed" | "pivot" = "running";
  if (pivotEv) status = "pivot";
  else if (doneEv) status = doneEv.payload?.ok === true ? "done" : "failed";

  const totalStories = (startedEv?.payload?.totalStories as number) ?? 0;
  const passed = memory.filter((m) => m.passes).length;
  const failed = memory.filter((m) => !m.passes).length;

  // Currently running story (from last story_running not yet followed by story_done/failed)
  const lastRunning = [...events].reverse().find((e) => e.kind === "story_running");
  const lastResolved = [...events]
    .reverse()
    .find((e) => e.kind === "story_done" || e.kind === "story_failed");
  let currentStory: string | null = null;
  if (
    lastRunning &&
    status === "running" &&
    (!lastResolved ||
      (lastResolved.seq ?? 0) < (lastRunning.seq ?? 0))
  ) {
    currentStory = (lastRunning.payload?.storyId as string) ?? null;
  }

  return NextResponse.json({
    autorunId,
    status,
    prdSlug: (startedEv?.payload?.prdSlug as string) ?? null,
    totalStories,
    alreadyPassing: (startedEv?.payload?.alreadyPassing as number) ?? 0,
    passed,
    failed,
    currentStory,
    pivotMessage: pivotEv ? (pivotEv.payload?.message as string) : null,
    doneReason: doneEv ? (doneEv.payload?.reason as string) : null,
    startedAt: startedEv?.ts ?? null,
    endedAt: doneEv?.ts ?? null,
    eventCount: events.length,
    memory,
  });
}
