#!/usr/bin/env tsx
/**
 * Spike 2b — execute a single story from a PRD.
 *
 * Reads PRD + story from filesystem, builds a rich prompt, spawns `claude -p`
 * with stream-json output, parses events and writes ForgeEvents to
 * .forge/<runId>/events.jsonl.
 *
 * Usage: tsx scripts/forge/exec-story.ts <runId> <prdSlug> <storyId>
 */
import { mkdirSync, appendFileSync, readFileSync, existsSync } from "node:fs";
import { spawn } from "node:child_process";
import { dirname, resolve } from "node:path";
import { ensureWorkspace } from "../../src/lib/forge/workspace.js";
import {
  ensureForgeHome,
  getRunPath,
} from "../../src/lib/forge/paths.js";
import { db } from "../../src/lib/db.js";
import type { Database } from "../../src/lib/supabase/database.types.js";

type ProjectRow = Database["public"]["Tables"]["Project"]["Row"];

const [, , runId, prdSlug, storyId] = process.argv;

if (!runId || !prdSlug || !storyId) {
  console.error("usage: exec-story.ts <runId> <prdSlug> <storyId>");
  process.exit(64);
}

const repoRoot = process.cwd();

// Eventos vão pra $FORGE_HOME/runs/<autorunId>/events.jsonl quando o autorun
// rodou em manifest mode (paths consistentes com exec-prd). Fallback legacy:
// .forge/<runId>/events.jsonl local pra Ralph.
const autorunId = process.env.FORGE_AUTORUN_ID ?? runId;
let eventsPath: string;
try {
  ensureForgeHome();
  eventsPath = resolve(getRunPath(autorunId), "events.jsonl");
} catch {
  eventsPath = resolve(repoRoot, ".forge", autorunId, "events.jsonl");
}
mkdirSync(dirname(eventsPath), { recursive: true });

let seq = 0;
function emit(kind: string, payload: Record<string, unknown> = {}) {
  seq += 1;
  const event = {
    runId,
    taskId: storyId,
    seq,
    ts: new Date().toISOString(),
    kind,
    payload,
  };
  appendFileSync(eventsPath, JSON.stringify(event) + "\n");
}

// Main async function to support await
async function main() {

emit("started", { pid: process.pid, prdSlug, storyId });

// ── Load PRD + story ──────────────────────────────────────────────────────

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
};

// Modo manifest (banco como SSOT): exec-prd materializou prd.json sintético
// em $FORGE_HOME/runs/<autorunId>/manifest-prd.json. Preferimos ele.
// Fallback legacy Ralph: scripts/ralph/features/<slug>/prd.json no repo.
let prdJsonPath: string;
const manifestPrdPath = resolve(getRunPath(autorunId), "manifest-prd.json");
if (existsSync(manifestPrdPath)) {
  prdJsonPath = manifestPrdPath;
} else {
  prdJsonPath = resolve(repoRoot, "scripts", "ralph", "features", prdSlug, "prd.json");
}
if (!existsSync(prdJsonPath)) {
  emit("error", { message: `prd.json not found: ${prdJsonPath}` });
  emit("done", { ok: false, totalEvents: seq + 1 });
  process.exit(2);
}

let stories: Story[] = [];
try {
  const parsed = JSON.parse(readFileSync(prdJsonPath, "utf-8"));
  stories = parsed.userStories ?? [];
} catch (err) {
  emit("error", { message: `failed to parse prd.json: ${err}` });
  emit("done", { ok: false, totalEvents: seq + 1 });
  process.exit(3);
}

const story = stories.find((s) => s.id === storyId);
if (!story) {
  emit("error", { message: `story ${storyId} not found in ${prdSlug}` });
  emit("done", { ok: false, totalEvents: seq + 1 });
  process.exit(4);
}

emit("story_loaded", {
  id: story.id,
  title: story.title,
  profile: story.agentProfile,
  estimateMinutes: story.estimateMinutes,
});

// Find PRD markdown — preferimos prd.md sintético do manifest se existir,
// senão fallback Ralph (docs/prd/<state>/prd-<slug>.md).
let prdMd = "";
const manifestMdPath = resolve(getRunPath(autorunId), "prd.md");
if (existsSync(manifestMdPath)) {
  prdMd = readFileSync(manifestMdPath, "utf-8");
} else {
  const states = ["backlog", "ready", "in-progress", "blocked", "done"] as const;
  for (const state of states) {
    const candidate = resolve(repoRoot, "docs", "prd", state, `prd-${prdSlug}.md`);
    if (existsSync(candidate)) {
      prdMd = readFileSync(candidate, "utf-8");
      break;
    }
  }
}

// Extract first ~3000 chars of PRD context (problem + decisions sections)
const prdContext = prdMd.length > 0 ? prdMd.slice(0, 4000) : "(PRD markdown not found)";

// ── Load memory.jsonl if running inside an autorun ────────────────────────
type MemoryEntry = {
  story: string;
  title: string;
  passes: boolean;
  summary: string;
  filesTouched: string[];
};

let memorySection = "";
const memPath = process.env.FORGE_MEMORY_PATH;
if (memPath && existsSync(memPath)) {
  try {
    const memLines = readFileSync(memPath, "utf-8")
      .split("\n")
      .filter((l) => l.trim());
    const entries = memLines.map((l) => JSON.parse(l) as MemoryEntry);
    const passed = entries.filter((e) => e.passes);
    if (passed.length > 0) {
      memorySection = [
        ``,
        `## Stories already completed in this PRD (autopilot memory)`,
        ``,
        `These ran before you in the same autorun. Use this context to avoid duplicating work,`,
        `know which files already exist, and respect prior decisions.`,
        ``,
        ...passed.map(
          (e, i) =>
            `**${i + 1}. ✓ ${e.story}** — ${e.title}\n` +
            `   Summary: ${e.summary}\n` +
            (e.filesTouched.length > 0
              ? `   Files: ${e.filesTouched.slice(0, 8).join(", ")}${e.filesTouched.length > 8 ? ", …" : ""}\n`
              : ""),
        ),
      ].join("\n");
    }
    emit("memory_loaded", { passedStories: passed.length });
  } catch (err) {
    emit("memory_load_error", { message: String(err) });
  }
}

// ── Build prompt ──────────────────────────────────────────────────────────

const prompt = [
  `# Forge Engine — Story Execution`,
  ``,
  `You are executing a single user story from a Product Requirement Document (PRD).`,
  `The PRD is the SSOT for the feature; the story is your scoped piece of work.`,
  ``,
  `## PRD context (first ~4KB)`,
  ``,
  prdContext,
  ``,
  `---`,
  memorySection,
  ``,
  `---`,
  ``,
  `## Story to execute`,
  ``,
  `**ID:** ${story.id}`,
  `**Title:** ${story.title}`,
  story.agentProfile ? `**Agent profile:** ${story.agentProfile}` : "",
  story.estimateMinutes ? `**Estimate:** ${story.estimateMinutes} minutes` : "",
  story.dependsOn?.length ? `**Depends on (assumed done):** ${story.dependsOn.join(", ")}` : "",
  ``,
  `**Description:**`,
  story.description ?? "(no description)",
  ``,
  `**Acceptance Criteria** (all must be satisfied):`,
  ...(story.acceptanceCriteria ?? []).map((ac, i) => `${i + 1}. ${ac}`),
  ``,
  `**Verifiable checks** (must execute and pass):`,
  ...(story.verifiable ?? []).map((v) => `- \`${v.kind}\`: \`${v.command_or_query}\` → expected: \`${v.expected}\``),
  ``,
  story.touches?.length
    ? `**Files this story is expected to touch:**\n${story.touches.map((t) => `- \`${t}\``).join("\n")}`
    : "",
  ``,
  `## Your task`,
  ``,
  `1. Read existing files referenced above (and any others you find relevant).`,
  `2. Implement the story to satisfy ALL acceptance criteria.`,
  `3. Run the verifiable checks; iterate until they pass.`,
  `4. When done, output a brief summary (1 paragraph) of what you changed.`,
  ``,
  `**Constraints:**`,
  `- Don't add features beyond what the story requires.`,
  `- Don't refactor unrelated code.`,
  `- If a verifiable check fails after 2 attempts, stop and report the blocker.`,
  `- Follow existing repo patterns (read neighbors before writing).`,
  ``,
  `Begin.`,
]
  .filter(Boolean)
  .join("\n");

emit("prompt_built", { promptLength: prompt.length, profile: story.agentProfile });

// ── Workspace setup (if projectId provided) ───────────────────────────────────

const STUB_PROJECT_ID = "00000000-0000-0000-0000-000000000000";
const projectId = process.env.FORGE_PROJECT_ID;
let workingDir = repoRoot; // Default: dogfood mode (Zordon)

if (projectId && projectId !== STUB_PROJECT_ID) {
  emit("status", { message: `fetching project ${projectId} for workspace setup` });

  // Fetch project from database
  const { data: project, error: projectError } = await db()
    .from("Project")
    .select("*")
    .eq("id", projectId)
    .maybeSingle();

  if (projectError) {
    emit("error", { message: `failed to fetch project: ${projectError.message}` });
    emit("done", { ok: false, totalEvents: seq + 1 });
    process.exit(5);
  }

  if (!project) {
    emit("error", { message: `project ${projectId} not found` });
    emit("done", { ok: false, totalEvents: seq + 1 });
    process.exit(6);
  }

  // Ensure workspace exists. IMPORTANTE: usamos autorunId aqui (não o
  // storyRunId individual) pra que TODAS as stories de um mesmo autorun
  // commitem na MESMA branch. ensureWorkspace é idempotente: a primeira story
  // faz reset+branch new; as subsequentes detectam (via sentinel) e só fazem
  // checkout, preservando o trabalho das stories anteriores.
  emit("status", { message: `setting up workspace for ${project.name}` });
  try {
    const { workspacePath, branch, freshClone } = ensureWorkspace({
      runId: autorunId,
      prdSlug,
      project: project as ProjectRow,
    });
    emit("status", {
      message: freshClone
        ? `workspace cloned fresh in ${workspacePath}`
        : `workspace reused at ${workspacePath}`,
    });

    workingDir = workspacePath;

    emit("workspace_ready", {
      path: workspacePath,
      branch,
      repoUrl: project.repoUrl,
      projectId: project.id,
      projectName: project.name,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    emit("error", { message: `workspace setup failed: ${message}` });
    emit("done", { ok: false, totalEvents: seq + 1 });
    process.exit(7);
  }
} else {
  emit("status", {
    message: projectId === STUB_PROJECT_ID
      ? "projectId is stub — using dogfood mode (cwd=Zordon)"
      : "no projectId — using dogfood mode (cwd=Zordon)"
  });
}

// ── Spawn Claude with stream-json output ─────────────────────────────────

emit("status", { message: "spawning claude -p with stream-json output" });

const claudeArgs = [
  "-p",
  prompt,
  "--output-format",
  "stream-json",
  "--verbose",
  "--max-turns",
  "30",
  "--permission-mode",
  "acceptEdits",
];

const claude = spawn("claude", claudeArgs, {
  cwd: workingDir,
  stdio: ["ignore", "pipe", "pipe"],
  env: { ...process.env, FORGE_RUN_ID: runId, FORGE_TASK_ID: storyId },
});

let stdoutBuffer = "";
let stderrBuffer = "";
let lastAssistantText = "";

claude.stdout?.on("data", (chunk) => {
  stdoutBuffer += chunk.toString();
  let nl: number;
  while ((nl = stdoutBuffer.indexOf("\n")) !== -1) {
    const line = stdoutBuffer.slice(0, nl).trim();
    stdoutBuffer = stdoutBuffer.slice(nl + 1);
    if (!line) continue;
    try {
      const ev = JSON.parse(line);
      handleClaudeEvent(ev);
    } catch {
      emit("raw_stdout", { line: line.slice(0, 500) });
    }
  }
});

claude.stderr?.on("data", (chunk) => {
  const text = chunk.toString();
  stderrBuffer += text;
  // Only emit stderr as event in chunks to avoid spam
  if (text.trim()) {
    emit("stderr", { text: text.slice(0, 500) });
  }
});

function handleClaudeEvent(ev: { type?: string; subtype?: string; message?: unknown }) {
  // The stream-json format from claude-code uses { type, ... } envelopes.
  // Common types: "system", "user", "assistant", "result", "tool_use", "tool_result"
  // We emit a curated subset.
  const t = ev.type ?? "unknown";

  if (t === "system") {
    emit("claude_system", { subtype: ev.subtype, summary: summarize(ev) });
    return;
  }

  if (t === "assistant") {
    const msg = (ev as { message?: { content?: Array<{ type?: string; text?: string; name?: string; input?: unknown }> } }).message;
    const blocks = msg?.content ?? [];
    for (const block of blocks) {
      if (block.type === "text" && block.text) {
        lastAssistantText = block.text;
        emit("assistant_text", { text: block.text.slice(0, 600) });
      } else if (block.type === "tool_use") {
        emit("tool_use", {
          tool: block.name,
          inputSummary: summarizeToolInput(block.name, block.input),
        });
      }
    }
    return;
  }

  if (t === "user") {
    const msg = (ev as { message?: { content?: Array<{ type?: string; content?: unknown; is_error?: boolean }> } }).message;
    const blocks = msg?.content ?? [];
    for (const block of blocks) {
      if (block.type === "tool_result") {
        emit("tool_result", {
          isError: !!block.is_error,
          preview: typeof block.content === "string" ? block.content.slice(0, 300) : "<structured>",
        });
      }
    }
    return;
  }

  if (t === "result") {
    emit("claude_result", {
      subtype: ev.subtype,
      summary: summarize(ev),
    });
    return;
  }

  emit("claude_other", { type: t, summary: summarize(ev) });
}

function summarize(obj: unknown): string {
  try {
    const s = JSON.stringify(obj);
    return s.length > 300 ? s.slice(0, 300) + "…" : s;
  } catch {
    return "[unserializable]";
  }
}

function summarizeToolInput(tool: string | undefined, input: unknown): string {
  if (!input || typeof input !== "object") return "";
  const obj = input as Record<string, unknown>;
  if (tool === "Read" || tool === "Edit" || tool === "Write") {
    return String(obj.file_path ?? obj.path ?? "");
  }
  if (tool === "Bash") {
    const cmd = String(obj.command ?? "");
    return cmd.length > 120 ? cmd.slice(0, 120) + "…" : cmd;
  }
  if (tool === "Grep" || tool === "Glob") {
    return String(obj.pattern ?? "");
  }
  return summarize(input).slice(0, 120);
}

claude.on("close", (code) => {
  emit("claude_closed", {
    exitCode: code,
    stderrTail: stderrBuffer.slice(-500),
    finalAssistantPreview: lastAssistantText.slice(0, 800),
  });
  emit("done", { ok: code === 0, totalEvents: seq + 1, exitCode: code });
  process.exit(code ?? 0);
});

claude.on("error", (err) => {
  emit("error", { message: err.message });
  emit("done", { ok: false, totalEvents: seq + 1 });
  process.exit(1);
});

// Safety: hard kill after 10 minutes
setTimeout(() => {
  emit("error", { message: "timeout 600s — killing claude" });
  claude.kill("SIGKILL");
  emit("done", { ok: false, totalEvents: seq + 1, killed: true });
  process.exit(124);
}, 600_000);

} // close main()

// Run main and catch errors
main().catch((err) => {
  emit("error", { message: `main() crashed: ${err instanceof Error ? err.message : String(err)}` });
  emit("done", { ok: false, totalEvents: seq + 1 });
  process.exit(1);
});
