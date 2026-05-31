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
import { ensureForgeHome, getRunPath } from "../../src/lib/forge/paths.js";
import { createEmitter } from "../../src/lib/forge/runtime/event-writer.js";
import { markRunRunning, updateRunProgress, markRunDone, markRunError } from "../../src/lib/forge/runtime/run-state.js";

const [, , autorunId, prdSlug, maxStoriesArg] = process.argv;
const maxStories = Number.parseInt(maxStoriesArg ?? "20", 10);

if (!autorunId || !prdSlug) {
  console.error("usage: exec-prd.ts <autorunId> <prdSlug> [maxStories]");
  process.exit(64);
}

// repoRoot é onde a CLI foi disparada (cwd do daemon). Usado pra path absoluto
// de modules do Volund (db, paths). O workspace do código do CLIENTE vive em
// $FORGE_HOME/workspaces/<slug>/ — resolvido por exec-story.ts via ensureWorkspace.
const repoRoot = process.cwd();

// Artifacts do run (eventos, memória, manifest) vivem em $FORGE_HOME/runs/<id>/.
// Fallback: se FORGE_HOME não-escrevível, cai em .forge/<id>/ local (Ralph-style).
let autorunDir: string;
try {
  ensureForgeHome();
  autorunDir = getRunPath(autorunId);
} catch {
  autorunDir = resolve(repoRoot, ".forge", autorunId);
}
const eventsPath = resolve(autorunDir, "events.jsonl");
const memoryPath = resolve(autorunDir, "memory.jsonl");
mkdirSync(autorunDir, { recursive: true });

const emitter = createEmitter({
  runId: autorunId,
  agentId: null,
  taskId: null,
  jsonlPath: eventsPath,
});

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

// ── PRD source: filesystem (Ralph legacy) OR ForgeRun.manifest (DB) ───────
//
// Modo banco: quando FORGE_RUN_ID está setado, materializamos o manifest
// imutável do ForgeRun pra um prd.json local efêmero em .forge/<runId>/
// — o resto do código (markStoryPasses, pickNextReady, etc.) continua igual,
// só apontando pro arquivo novo. Eventos sobem normalmente pra ForgeEvent.
//
// Modo FS: comportamento Ralph original — lê scripts/ralph/features/<slug>/prd.json.

const forgeRunId = process.env.FORGE_RUN_ID ?? null;
const isManifestMode = !!forgeRunId;

// Resolvido em main() — bootstrap do manifest precisa de await, que não pode
// ficar no top-level (tsx compila pra CJS neste repo). Ver bootstrapPrdSource().
let prdJsonPath: string = "";

async function bootstrapPrdSource() {
  if (isManifestMode) {
    prdJsonPath = resolve(autorunDir, "manifest-prd.json");
    await bootstrapFromManifest(forgeRunId!, prdJsonPath);
  } else {
    prdJsonPath = resolve(repoRoot, "scripts", "ralph", "features", prdSlug, "prd.json");
    if (!existsSync(prdJsonPath)) {
      emitter.emit("error", { message: `prd.json not found: ${prdJsonPath}` });
      emitter.emit("autorun_done", { ok: false, reason: "no_prd_json" });
      if (isManifestMode && forgeRunId) {
        await markRunError(forgeRunId, "no_prd_json");
      }
      await emitter.close();
      process.exit(2);
    }
  }
}

async function bootstrapFromManifest(runId: string, outPath: string) {
  const { db } = await import(resolve(repoRoot, "src/lib/db.ts"));
  const supabase = db();
  const { data, error } = await supabase
    .from("ForgeRun")
    .select("manifest, projectId")
    .eq("id", runId)
    .maybeSingle();
  if (error || !data) {
    emitter.emit("error", { message: `ForgeRun ${runId} not found: ${error?.message ?? "missing"}` });
    emitter.emit("autorun_done", { ok: false, reason: "no_forge_run" });
    await emitter.close();
    process.exit(2);
  }
  const manifest = data.manifest as {
    version?: number;
    prds?: Array<{
      reference?: string;
      title?: string;
      problem?: string;
      goal?: string;
      oneLiner?: string;
      stories?: Story[];
    }>;
  };
  if (!manifest?.prds) {
    emitter.emit("error", { message: `ForgeRun ${runId} manifest has no prds` });
    emitter.emit("autorun_done", { ok: false, reason: "empty_manifest" });
    await emitter.close();
    process.exit(2);
  }
  // Achata todas as stories. dependsOn governa ordem entre stories da mesma
  // PRD; entre PRDs distintos, ordem é a do manifest (snapshot order).
  const userStories: Story[] = [];
  for (const prd of manifest.prds) {
    for (const story of prd.stories ?? []) {
      userStories.push({ ...story, passes: false });
    }
  }
  writeFileSync(
    outPath,
    JSON.stringify({ userStories, _source: { runId, version: manifest.version } }, null, 2) + "\n",
  );

  // Gera prd.md sintético pra exec-story.ts consumir como contexto.
  // Sem isso, o prompt do Claude perde o "porquê" dos PRDs.
  const mdLines: string[] = [
    `# Forge Run Manifest`,
    ``,
    `Run: ${runId}`,
    `Snapshot of ${manifest.prds.length} PRD${manifest.prds.length > 1 ? "s" : ""}.`,
    ``,
  ];
  for (const prd of manifest.prds) {
    mdLines.push(`## ${prd.reference ?? "(no ref)"} — ${prd.title ?? "(no title)"}`);
    mdLines.push("");
    if (prd.oneLiner) mdLines.push(`> ${prd.oneLiner}`, "");
    if (prd.problem) mdLines.push(`### Problema`, "", prd.problem, "");
    if (prd.goal) mdLines.push(`### Objetivo`, "", prd.goal, "");
    if (prd.stories?.length) {
      mdLines.push(`### Stories (${prd.stories.length})`, "");
      for (const s of prd.stories) {
        mdLines.push(`- **${s.id}** — ${s.title}`);
      }
      mdLines.push("");
    }
  }
  const mdPath = resolve(autorunDir, "prd.md");
  writeFileSync(mdPath, mdLines.join("\n"));

  // Persiste projectId pra exec-story usar (workspace setup precisa dele).
  if (data.projectId) {
    writeFileSync(resolve(autorunDir, "project-id"), data.projectId);
  }

  emitter.emit("manifest_bootstrapped", {
    runId,
    storyCount: userStories.length,
    prdCount: manifest.prds.length,
    projectId: data.projectId,
  });
}

function readProjectIdEnv(): Record<string, string> {
  const path = resolve(autorunDir, "project-id");
  if (!existsSync(path)) return {};
  try {
    const id = readFileSync(path, "utf-8").trim();
    if (id) return { FORGE_PROJECT_ID: id };
  } catch {
    // ignore
  }
  return {};
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
  // Em modo manifest, o "estado" do PRD vive em ForgeRun.status (banco), não
  // no filesystem. Skip silencioso pra não mexer em docs/prd/ do repo host.
  if (isManifestMode) return null;
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
    emitter.emit("prd_move_error", { from: found.state, to: targetState, message: String(err) });
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
  // Marca offset do events.jsonl ANTES de spawnar exec-story. Tudo que ele
  // appendar daqui pra frente até o close pertence a esta story (filtramos
  // depois por runId==storyRunId pra ser preciso quando stories rodam em
  // paralelo no futuro). Hoje rodam sequenciais — offset basta.
  const eventsOffsetStart = existsSync(eventsPath)
    ? readFileSync(eventsPath, "utf-8").length
    : 0;
  emitter.emit("story_picked", {
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
        // Em modo manifest, propaga projectId pro exec-story spinar workspace.
        // Lido do arquivo escrito no bootstrap (acima).
        ...(isManifestMode ? readProjectIdEnv() : {}),
      },
    },
  );

  const startedAt = Date.now();
  const exitCode: number | null = await new Promise((res) => {
    child.on("close", (code) => res(code));
    child.on("error", (err) => {
      emitter.emit("story_spawn_error", { storyId: story.id, message: err.message });
      res(-1);
    });
  });
  const durationMs = Date.now() - startedAt;

  // Read story events do events.jsonl COMPARTILHADO do autorun, filtrando
  // por runId==storyRunId (cada linha que exec-story escreveu tem esse campo).
  // Ler só o que foi appendado depois do offset acelera + filtra cross-stories.
  type StoryEvent = {
    runId?: string;
    taskId?: string;
    kind?: string;
    payload?: Record<string, unknown>;
  };
  let storyEvents: StoryEvent[] = [];
  if (existsSync(eventsPath)) {
    try {
      const fullText = readFileSync(eventsPath, "utf-8");
      const newText = fullText.slice(eventsOffsetStart);
      const lines = newText.split("\n").filter((l) => l.trim());
      storyEvents = lines
        .map((l) => {
          try { return JSON.parse(l) as StoryEvent; } catch { return null; }
        })
        .filter((e): e is StoryEvent => !!e && e.runId === storyRunId);
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

  // Mirror REMOVIDO — exec-story escreve direto no events.jsonl do autorun
  // (compartilhado). Duplicar prefixando com "story:" só inflava o arquivo.

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
  await bootstrapPrdSource();
  const data = readPrdJson();
  const stories: Story[] = data.userStories ?? [];
  const initialPasses = stories.filter((s) => s.passes).length;

  emitter.emit("autorun_started", {
    prdSlug,
    totalStories: stories.length,
    alreadyPassing: initialPasses,
    maxStories,
  });

  // Mark run as running in ForgeRun table
  if (isManifestMode && forgeRunId) {
    await markRunRunning(forgeRunId);
  }

  // Ensure PRD is in in-progress/ — kanban reflects state immediately
  const moveToProgress = movePrdState("in-progress");
  if (moveToProgress) {
    emitter.emit("prd_state_change", moveToProgress);
  }

  let executed = 0;
  let consecutiveFailures = 0;
  let lastFailedId: string | null = null;

  while (executed < maxStories) {
    // Re-read prd.json to pick up any updates (passes mutated during loop)
    const fresh = readPrdJson();
    const ready = pickNextReady(fresh.userStories);
    if (!ready) {
      emitter.emit("autorun_no_more_ready", { executed });
      break;
    }

    emitter.emit("story_running", { storyId: ready.id, executed: executed + 1, of: maxStories });
    const { ok, entry } = await runStory(ready);
    appendMemory(entry);
    executed += 1;

    if (ok) {
      markStoryPasses(ready.id, true);
      emitter.emit("story_done", {
        storyId: ready.id,
        passes: true,
        durationMs: entry.durationMs,
        filesTouched: entry.filesTouched.length,
      });

      // Update progress in ForgeRun after each story passes
      if (isManifestMode && forgeRunId) {
        const passedCount = fresh.userStories.filter((s) => s.passes).length + 1;
        await updateRunProgress(forgeRunId, passedCount, stories.length);
      }

      consecutiveFailures = 0;
      lastFailedId = null;
    } else {
      emitter.emit("story_failed", {
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
        emitter.emit("autorun_pivot", {
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
        if (moveBlocked) emitter.emit("prd_state_change", moveBlocked);
        if (isManifestMode && forgeRunId) {
          await markRunError(forgeRunId, "pivot_required");
        }
        emitter.emit("autorun_done", { ok: false, reason: "pivot_required", executed });
        await emitter.close();
        process.exit(0);
      }
      // Otherwise: stop on first failure of a story (conservative default)
      const moveBlockedFail = movePrdState("blocked");
      if (moveBlockedFail) emitter.emit("prd_state_change", moveBlockedFail);
      if (isManifestMode && forgeRunId) {
        await markRunError(forgeRunId, "story_failed");
      }
      emitter.emit("autorun_done", { ok: false, reason: "story_failed", executed });
      await emitter.close();
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
    if (moveDone) emitter.emit("prd_state_change", moveDone);
  }

  const doneReason = allDone ? "all_passed" : executed >= maxStories ? "max_reached" : "no_more_ready";

  if (isManifestMode && forgeRunId) {
    await markRunDone(forgeRunId, doneReason);
  }

  emitter.emit("autorun_done", {
    ok: true,
    reason: doneReason,
    executed,
    finalPasses,
    totalStories: finalData.userStories.length,
  });
  await emitter.close();
  process.exit(0);
}

main().catch(async (err) => {
  emitter.emit("autorun_crash", { message: String(err), stack: err?.stack });
  if (isManifestMode && forgeRunId) {
    await markRunError(forgeRunId, "crash");
  }
  await emitter.close();
  process.exit(1);
});
