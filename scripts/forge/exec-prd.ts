#!/usr/bin/env tsx
/**
 * Autopilot orchestrator — runs all ready stories of a PRD sequentially.
 *
 * Usage: tsx scripts/forge/exec-prd.ts <autorunId> <prdSlug> [maxStories]
 *
 * Behaviour:
 *  1. Reads prd.json, builds list of pending stories
 *  2. Loop: pick next ready (deps satisfied, passes=false)
 *  3. Spawn exec-story.ts with the autorun's events.jsonl path passed via
 *     env so all events stream into ONE file
 *  4. Wait until story emits 'done' event in events.jsonl
 *  5. If ok: mark passes=true in prd.json, append to memory.jsonl
 *  6. If failed: mark and abort (no retry in this minimal version)
 *  7. Stop when no more ready stories or maxStories reached
 *
 * Filesystem layout for one autorun:
 *   .forge/<autorunId>/
 *     ├─ events.jsonl     ← orchestrator-level + per-story events appended
 *     ├─ memory.jsonl     ← 1 line per passed story (summary + files + cost)
 *     └─ tasks/<storyRunId>/events.jsonl  ← each story's raw stream
 */
import { mkdirSync, appendFileSync, readFileSync, writeFileSync, existsSync, renameSync, readdirSync } from "node:fs";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { resolve, dirname, basename, join } from "node:path";

const [, , autorunId, prdSlug, maxStoriesArg] = process.argv;
const maxStories = Number.parseInt(maxStoriesArg ?? "20", 10);

if (!autorunId || !prdSlug) {
  console.error("usage: exec-prd.ts <autorunId> <prdSlug> [maxStories]");
  process.exit(64);
}

const repoRoot = process.cwd();
const autorunDir = resolve(repoRoot, ".forge", autorunId);
const eventsPath = resolve(autorunDir, "events.jsonl");
const memoryPath = resolve(autorunDir, "memory.jsonl");
mkdirSync(autorunDir, { recursive: true });

let seq = 0;
function emit(kind: string, payload: Record<string, unknown> = {}) {
  seq += 1;
  const event = {
    runId: autorunId,
    seq,
    ts: new Date().toISOString(),
    kind,
    payload,
  };
  appendFileSync(eventsPath, JSON.stringify(event) + "\n");
}

// ── Load prd.json ────────────────────────────────────────────────────────

type Story = {
  id: string;
  title: string;
  description?: string;
  acceptanceCriteria?: string[];
  verifiable?: Array<{ kind: string; command_or_query: string; expected: string }>;
  touches?: string[];
  dependsOn?: string[];
  estimateMinutes?: number;
  agentProfile?: string;
  passes?: boolean;
};

const prdJsonPath = resolve(repoRoot, "scripts", "ralph", "features", prdSlug, "prd.json");
if (!existsSync(prdJsonPath)) {
  emit("error", { message: `prd.json not found: ${prdJsonPath}` });
  emit("autorun_done", { ok: false, reason: "no_prd_json" });
  process.exit(2);
}

function readPrdJson(): { userStories: Story[]; [k: string]: unknown } {
  const raw = readFileSync(prdJsonPath, "utf-8");
  return JSON.parse(raw);
}

function writePrdJson(data: unknown) {
  writeFileSync(prdJsonPath, JSON.stringify(data, null, 2) + "\n");
}

function markStoryPasses(storyId: string, passes: boolean) {
  const data = readPrdJson();
  const idx = data.userStories.findIndex((s) => s.id === storyId);
  if (idx >= 0) {
    data.userStories[idx].passes = passes;
    writePrdJson(data);
  }
}

// ── Filesystem-as-state: move PRD between {backlog,ready,in-progress,blocked,done,archive}/ ──
const PRD_STATES = ["backlog", "ready", "in-progress", "blocked", "done", "archive"];

function findPrdFile(slug: string): { state: string; path: string } | null {
  for (const state of PRD_STATES) {
    const dir = resolve(repoRoot, "docs", "prd", state);
    if (!existsSync(dir)) continue;
    const candidate = resolve(dir, `prd-${slug}.md`);
    if (existsSync(candidate)) return { state, path: candidate };
    // Archive may have trailing date suffix — scan dir
    try {
      const entries = readdirSync(dir);
      for (const entry of entries) {
        if (!entry.startsWith(`prd-${slug}`) && !entry.startsWith("prd-")) continue;
        const base = entry.replace(/^prd-/, "").replace(/\.md$/, "").replace(/-\d{8}$/, "");
        if (base === slug) return { state, path: resolve(dir, entry) };
      }
    } catch {
      // ignore
    }
  }
  return null;
}

function movePrdState(targetState: string): { from: string; to: string } | null {
  const found = findPrdFile(prdSlug);
  if (!found) return null;
  if (found.state === targetState) return null;
  const targetDir = resolve(repoRoot, "docs", "prd", targetState);
  if (!existsSync(targetDir)) return null;
  const targetPath = join(targetDir, basename(found.path));
  try {
    renameSync(found.path, targetPath);
    return { from: found.state, to: targetState };
  } catch (err) {
    emit("prd_move_error", { from: found.state, to: targetState, message: String(err) });
    return null;
  }
}

function pickNextReady(stories: Story[]): Story | null {
  const doneIds = new Set(stories.filter((s) => s.passes).map((s) => s.id));
  for (const s of stories) {
    if (s.passes) continue;
    const deps = s.dependsOn ?? [];
    const ready = deps.every((d) => doneIds.has(d));
    if (ready) return s;
  }
  return null;
}

// ── Memory helpers ────────────────────────────────────────────────────────

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

function appendMemory(entry: MemoryEntry) {
  appendFileSync(memoryPath, JSON.stringify(entry) + "\n");
}

// ── Spawn a story worker ──────────────────────────────────────────────────

async function runStory(story: Story): Promise<{ ok: boolean; entry: MemoryEntry }> {
  const storyRunId = randomUUID();
  const storyEventsPath = resolve(repoRoot, ".forge", storyRunId, "events.jsonl");
  emit("story_picked", {
    storyId: story.id,
    title: story.title,
    profile: story.agentProfile,
    storyRunId,
  });

  const execStoryPath = resolve(repoRoot, "scripts/forge/exec-story.ts");
  const child = spawn(
    "npx",
    ["tsx", execStoryPath, storyRunId, prdSlug, story.id],
    {
      cwd: repoRoot,
      detached: false, // we wait for it; not detached
      stdio: "ignore",
      env: {
        ...process.env,
        FORGE_AUTORUN_ID: autorunId,
        FORGE_MEMORY_PATH: memoryPath,
      },
    },
  );

  const startedAt = Date.now();
  const exitCode: number | null = await new Promise((res) => {
    child.on("close", (code) => res(code));
    child.on("error", (err) => {
      emit("story_spawn_error", { storyId: story.id, message: err.message });
      res(-1);
    });
  });
  const durationMs = Date.now() - startedAt;

  // Read story events to extract metadata
  let storyEvents: Array<{ kind?: string; payload?: Record<string, unknown> }> = [];
  if (existsSync(storyEventsPath)) {
    try {
      const lines = readFileSync(storyEventsPath, "utf-8")
        .split("\n")
        .filter((l) => l.trim());
      storyEvents = lines.map((l) => JSON.parse(l));
    } catch {
      // ignore
    }
  }
  const doneEv = [...storyEvents].reverse().find((e) => e.kind === "done");
  const ok = doneEv?.payload?.ok === true && exitCode === 0;

  // Extract files touched via Edit/Write tool_use events
  const filesTouched = Array.from(
    new Set(
      storyEvents
        .filter((e) => e.kind === "tool_use")
        .map((e) => {
          const tool = e.payload?.tool as string | undefined;
          const summary = e.payload?.inputSummary as string | undefined;
          if (!summary) return null;
          if (tool === "Edit" || tool === "Write") return summary;
          return null;
        })
        .filter((x): x is string => !!x),
    ),
  );

  // Get final claude message for summary
  const finalText = storyEvents
    .filter((e) => e.kind === "assistant_text")
    .map((e) => e.payload?.text as string)
    .filter(Boolean)
    .pop() ?? "";
  const summary = finalText.slice(0, 400);

  // Mirror story events into autorun events.jsonl with prefix
  for (const ev of storyEvents) {
    seq += 1;
    const mirrored = {
      runId: autorunId,
      seq,
      ts: new Date().toISOString(),
      kind: `story:${ev.kind}`,
      payload: { storyId: story.id, ...ev.payload },
    };
    appendFileSync(eventsPath, JSON.stringify(mirrored) + "\n");
  }

  const entry: MemoryEntry = {
    story: story.id,
    title: story.title,
    passes: ok,
    summary,
    filesTouched,
    durationMs,
    totalEvents: storyEvents.length,
    exitCode,
  };

  return { ok, entry };
}

// ── Main loop ────────────────────────────────────────────────────────────

async function main() {
  const data = readPrdJson();
  const stories: Story[] = data.userStories ?? [];
  const initialPasses = stories.filter((s) => s.passes).length;

  emit("autorun_started", {
    prdSlug,
    totalStories: stories.length,
    alreadyPassing: initialPasses,
    maxStories,
  });

  // Ensure PRD is in in-progress/ — kanban reflects state immediately
  const moveToProgress = movePrdState("in-progress");
  if (moveToProgress) {
    emit("prd_state_change", moveToProgress);
  }

  let executed = 0;
  let consecutiveFailures = 0;
  let lastFailedId: string | null = null;

  while (executed < maxStories) {
    // Re-read prd.json to pick up any updates (passes mutated during loop)
    const fresh = readPrdJson();
    const ready = pickNextReady(fresh.userStories);
    if (!ready) {
      emit("autorun_no_more_ready", { executed });
      break;
    }

    emit("story_running", { storyId: ready.id, executed: executed + 1, of: maxStories });
    const { ok, entry } = await runStory(ready);
    appendMemory(entry);
    executed += 1;

    if (ok) {
      markStoryPasses(ready.id, true);
      emit("story_done", {
        storyId: ready.id,
        passes: true,
        durationMs: entry.durationMs,
        filesTouched: entry.filesTouched.length,
      });
      consecutiveFailures = 0;
      lastFailedId = null;
    } else {
      emit("story_failed", {
        storyId: ready.id,
        durationMs: entry.durationMs,
        exitCode: entry.exitCode,
      });
      if (ready.id === lastFailedId) {
        consecutiveFailures += 1;
      } else {
        consecutiveFailures = 1;
        lastFailedId = ready.id;
      }
      if (consecutiveFailures >= 2) {
        emit("autorun_pivot", {
          storyId: ready.id,
          message: "2 consecutive failures on same story — pivot required",
        });
        // Write pivot-required.md
        const pivotPath = resolve(autorunDir, "pivot-required.md");
        writeFileSync(
          pivotPath,
          `# Pivot required — ${prdSlug} / ${ready.id}\n\n` +
            `Autorun stopped after 2 consecutive failures on story **${ready.id}**.\n\n` +
            `**Suggestion:** revisit the PRD — the story's AC or verifiable may be impossible or ` +
            `misaligned with the current repo state.\n\n` +
            `Last memory entry:\n\`\`\`json\n${JSON.stringify(entry, null, 2)}\n\`\`\`\n`,
        );
        const moveBlocked = movePrdState("blocked");
        if (moveBlocked) emit("prd_state_change", moveBlocked);
        emit("autorun_done", { ok: false, reason: "pivot_required", executed });
        process.exit(0);
      }
      // Otherwise: stop on first failure of a story (conservative default)
      const moveBlockedFail = movePrdState("blocked");
      if (moveBlockedFail) emit("prd_state_change", moveBlockedFail);
      emit("autorun_done", { ok: false, reason: "story_failed", executed });
      process.exit(0);
    }
  }

  // Reached max or no more ready
  const finalData = readPrdJson();
  const finalPasses = finalData.userStories.filter((s) => s.passes).length;
  const allDone = finalPasses === finalData.userStories.length;

  // PRD lifecycle: all passing → done; partial → keep in-progress (idempotent retry possible)
  if (allDone) {
    const moveDone = movePrdState("done");
    if (moveDone) emit("prd_state_change", moveDone);
  }

  emit("autorun_done", {
    ok: true,
    reason: allDone ? "all_passed" : executed >= maxStories ? "max_reached" : "no_more_ready",
    executed,
    finalPasses,
    totalStories: finalData.userStories.length,
  });
  process.exit(0);
}

main().catch((err) => {
  emit("autorun_crash", { message: String(err), stack: err?.stack });
  process.exit(1);
});
