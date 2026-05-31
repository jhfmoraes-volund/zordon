/**
 * Filesystem helpers for PRD governance (Ralph-style filesystem-as-state).
 * Read-only for now — spike 2a.
 */
import { readdir, readFile, rename, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import { basename, join, resolve } from "node:path";

export type PrdState =
  | "backlog"
  | "ready"
  | "in-progress"
  | "blocked"
  | "done"
  | "archive";

export const PRD_STATES: PrdState[] = [
  "backlog",
  "ready",
  "in-progress",
  "blocked",
  "done",
  "archive",
];

export type PrdSummary = {
  slug: string;
  state: PrdState;
  path: string;
  title: string;
  size: number;
  modifiedAt: string;
  hasPlanJson: boolean;
  storyCount: number;
  storyPasses: number;
  runs: PrdRunsAgg;
};

export type RunStatus = "done" | "failed" | "running";

export type RunSummary = {
  runId: string;
  prdSlug: string | null;
  storyId: string | null;
  status: RunStatus;
  startedAt: string;
  endedAt: string | null;
  eventCount: number;
  isAutorun: boolean;
};

export type PrdRunsAgg = {
  total: number;
  running: number;
  lastRunAt: string | null;
  lastRunStatus: RunStatus | null;
  lastStoryId: string | null;
  lastAutorunId: string | null;
  lastAutorunStatus: RunStatus | null;
  autorunRunning: boolean;
};

const EMPTY_RUNS_AGG: PrdRunsAgg = {
  total: 0,
  running: 0,
  lastRunAt: null,
  lastRunStatus: null,
  lastStoryId: null,
  lastAutorunId: null,
  lastAutorunStatus: null,
  autorunRunning: false,
};

export type ForgeStory = {
  id: string;
  title: string;
  description?: string;
  agentProfile?: string;
  estimateMinutes?: number;
  dependsOn?: string[];
  passes?: boolean;
  acceptanceCriteria?: string[];
  verifiable?: Array<{ kind: string; command_or_query: string; expected: string }>;
  touches?: string[];
};

export type PrdDetail = PrdSummary & {
  content: string;
  stories: ForgeStory[];
};

const repoRoot = () => process.cwd();
const prdDir = (state: PrdState) => join(repoRoot(), "docs", "prd", state);
const featureDir = (slug: string) => join(repoRoot(), "scripts", "ralph", "features", slug);
const forgeDir = () => join(repoRoot(), ".forge");

/**
 * Scan .forge/<runId>/events.jsonl for all known runs. Returns one summary per run.
 * Skips dirs without events.jsonl, or with malformed first event.
 */
export async function listRuns(): Promise<RunSummary[]> {
  const dir = forgeDir();
  if (!existsSync(dir)) return [];
  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch {
    return [];
  }
  const runs: RunSummary[] = [];
  for (const entry of entries) {
    const eventsPath = join(dir, entry, "events.jsonl");
    if (!existsSync(eventsPath)) continue;
    let content: string;
    try {
      content = await readFile(eventsPath, "utf-8");
    } catch {
      continue;
    }
    const lines = content.split("\n").filter((l) => l.trim().length > 0);
    if (lines.length === 0) continue;

    type Event = { kind?: string; ts?: string; payload?: Record<string, unknown>; taskId?: string };
    const events: Event[] = [];
    for (const line of lines) {
      try {
        events.push(JSON.parse(line));
      } catch {
        // skip malformed
      }
    }
    if (events.length === 0) continue;

    // Find the "start" event — either story-run ('started') or autorun ('autorun_started')
    const startedEvent = events.find(
      (e) => e.kind === "started" || e.kind === "autorun_started",
    );
    const isAutorun = startedEvent?.kind === "autorun_started";

    // Find the "end" event — story 'done' or autorun 'autorun_done'
    const doneEvent = [...events].reverse().find(
      (e) => e.kind === "done" || e.kind === "autorun_done",
    );

    const prdSlug = (startedEvent?.payload?.prdSlug as string | undefined) ?? null;
    const storyId =
      (startedEvent?.payload?.storyId as string | undefined) ??
      (startedEvent?.taskId as string | undefined) ??
      null;

    let status: RunStatus = "running";
    if (doneEvent) {
      status = doneEvent.payload?.ok === true ? "done" : "failed";
    }

    runs.push({
      runId: entry,
      prdSlug,
      storyId,
      status,
      startedAt: events[0].ts ?? new Date(0).toISOString(),
      endedAt: doneEvent?.ts ?? null,
      eventCount: events.length,
      isAutorun,
    });
  }
  // Newest first
  runs.sort((a, b) => b.startedAt.localeCompare(a.startedAt));
  return runs;
}

/**
 * Aggregate runs by prdSlug.
 */
function aggregateRunsByPrd(runs: RunSummary[]): Map<string, PrdRunsAgg> {
  const byPrd = new Map<string, RunSummary[]>();
  for (const run of runs) {
    if (!run.prdSlug) continue;
    const list = byPrd.get(run.prdSlug) ?? [];
    list.push(run);
    byPrd.set(run.prdSlug, list);
  }
  const result = new Map<string, PrdRunsAgg>();
  for (const [slug, list] of byPrd) {
    const last = list[0]; // already sorted newest first
    const lastAutorun = list.find((r) => r.isAutorun);
    result.set(slug, {
      total: list.length,
      running: list.filter((r) => r.status === "running").length,
      lastRunAt: last?.startedAt ?? null,
      lastRunStatus: last?.status ?? null,
      lastStoryId: last?.storyId ?? null,
      lastAutorunId: lastAutorun?.runId ?? null,
      lastAutorunStatus: lastAutorun?.status ?? null,
      autorunRunning: lastAutorun?.status === "running",
    });
  }
  return result;
}

/**
 * Extract slug from filename: "prd-forge-engine.md" → "forge-engine".
 * Archived PRDs may have trailing date: "prd-foo-20260529.md" → "foo" (strip date).
 */
function slugFromFilename(filename: string): string {
  const base = filename.replace(/^prd-/, "").replace(/\.md$/, "");
  // Strip trailing -YYYYMMDD if present (archived)
  return base.replace(/-\d{8}$/, "");
}

/**
 * Extract title from PRD markdown: first `# ` H1 line.
 * Skips lines inside fenced code blocks (``` ... ```).
 */
function extractTitle(content: string): string {
  const lines = content.split("\n");
  let inFence = false;
  for (const line of lines) {
    if (line.trim().startsWith("```")) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    const match = line.match(/^#\s+(.+)$/);
    if (match) return match[1].trim();
  }
  return "(no title)";
}

/**
 * Try to load stories from scripts/ralph/features/<slug>/prd.json.
 * Returns empty array if missing or malformed.
 */
async function loadStories(slug: string): Promise<{ stories: ForgeStory[]; hasPlanJson: boolean }> {
  const path = join(featureDir(slug), "prd.json");
  if (!existsSync(path)) return { stories: [], hasPlanJson: false };
  try {
    const raw = await readFile(path, "utf-8");
    const parsed = JSON.parse(raw) as { userStories?: ForgeStory[] };
    return { stories: parsed.userStories ?? [], hasPlanJson: true };
  } catch {
    return { stories: [], hasPlanJson: true };
  }
}

export async function listPrds(): Promise<PrdSummary[]> {
  const results: PrdSummary[] = [];
  const runsByPrd = aggregateRunsByPrd(await listRuns());

  for (const state of PRD_STATES) {
    const dir = prdDir(state);
    if (!existsSync(dir)) continue;
    let entries: string[];
    try {
      entries = await readdir(dir);
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (!entry.startsWith("prd-") || !entry.endsWith(".md")) continue;
      const path = join(dir, entry);
      const slug = slugFromFilename(entry);
      let s: Awaited<ReturnType<typeof stat>>;
      try {
        s = await stat(path);
      } catch {
        continue;
      }
      let content = "";
      try {
        content = await readFile(path, "utf-8");
      } catch {
        // ignore
      }
      const title = extractTitle(content);
      const { stories, hasPlanJson } = await loadStories(slug);
      results.push({
        slug,
        state,
        path: path.replace(repoRoot() + "/", ""),
        title,
        size: s.size,
        modifiedAt: s.mtime.toISOString(),
        hasPlanJson,
        storyCount: stories.length,
        storyPasses: stories.filter((s) => s.passes).length,
        runs: runsByPrd.get(slug) ?? EMPTY_RUNS_AGG,
      });
    }
  }

  // Sort: by state order, then by title
  results.sort((a, b) => {
    const sa = PRD_STATES.indexOf(a.state) - PRD_STATES.indexOf(b.state);
    if (sa !== 0) return sa;
    return a.title.localeCompare(b.title);
  });

  return results;
}

/**
 * Find a PRD across all states by slug. Returns null if not found.
 */
async function findPrd(slug: string): Promise<{ state: PrdState; path: string } | null> {
  for (const state of PRD_STATES) {
    const path = join(prdDir(state), `prd-${slug}.md`);
    if (existsSync(path)) return { state, path };
    // Archived may have suffix
    const dir = prdDir(state);
    if (!existsSync(dir)) continue;
    try {
      const entries = await readdir(dir);
      for (const entry of entries) {
        if (slugFromFilename(entry) === slug) {
          return { state, path: join(dir, entry) };
        }
      }
    } catch {
      // ignore
    }
  }
  return null;
}

export async function readPrd(slug: string): Promise<PrdDetail | null> {
  const found = await findPrd(slug);
  if (!found) return null;
  const { state, path } = found;

  const [s, content, { stories, hasPlanJson }, runs] = await Promise.all([
    stat(path),
    readFile(path, "utf-8"),
    loadStories(slug),
    listRuns(),
  ]);
  const runsAgg = aggregateRunsByPrd(runs).get(slug) ?? EMPTY_RUNS_AGG;

  return {
    slug,
    state,
    path: path.replace(repoRoot() + "/", ""),
    title: extractTitle(content),
    size: s.size,
    modifiedAt: s.mtime.toISOString(),
    hasPlanJson,
    storyCount: stories.length,
    storyPasses: stories.filter((s) => s.passes).length,
    runs: runsAgg,
    content,
    stories,
  };
}

// Re-export resolve for callers that need absolute paths
export { resolve as resolvePath };

/**
 * Move a PRD markdown from its current state directory to a target state.
 * Filesystem-as-state semantics — `state` IS the parent directory.
 * Returns the new relative path, or null if PRD not found or already at target.
 */
export async function movePrd(
  slug: string,
  targetState: PrdState,
): Promise<{ fromState: PrdState; toState: PrdState; newPath: string } | null> {
  const found = await findPrd(slug);
  if (!found) return null;
  if (found.state === targetState) return null;

  const filename = basename(found.path);
  const targetDir = prdDir(targetState);
  if (!existsSync(targetDir)) return null;
  const targetPath = join(targetDir, filename);

  await rename(found.path, targetPath);
  return {
    fromState: found.state,
    toState: targetState,
    newPath: targetPath.replace(repoRoot() + "/", ""),
  };
}
