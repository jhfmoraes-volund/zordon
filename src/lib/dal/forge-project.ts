import "server-only";
import { randomUUID } from "node:crypto";
import { db } from "@/lib/db";
import { getPrdsForSession } from "@/lib/dal/product-requirements";
import { createJob } from "@/lib/forge/dal/job";
import type { PrdRunState } from "@/lib/forge/run-state";
import type { Database, Json } from "@/lib/supabase/database.types";

type Tables = Database["public"]["Tables"];
type ForgeRunRow = Tables["ForgeRun"]["Row"];
type ProductRequirementRow = Tables["ProductRequirement"]["Row"];

// ─── Types ────────────────────────────────────────────────────────────────────

/**
 * PRD line item exposed na UI da tab Forge quando a session é DB-sourced.
 * Forma minimal pra renderizar card + decisão de gating.
 */
export type ForgePrdItem = {
  id: string;
  reference: string;
  title: string;
  /** Spec status (draft/review/approved/superseded) — session world. */
  status: string;
  oneLiner: string;
  acCount: number;
  /** Execution state in the Forge — what the Forge UI shows instead of `status`. */
  runState: PrdRunState;
};

export type PrdRunInfo = {
  runState: PrdRunState;
  runId: string | null;
  currentPhase: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  durationMs: number | null;
  lastEvents: Array<{ kind: string; ts: string; summary: string }>;
};

type ManifestPrdRef = { reference?: string };
type RunEventRow = {
  kind: string;
  ts: string;
  payload: Record<string, unknown> | null;
};

/** Human-readable one-liner for a run event, used in card previews. */
export function summarizeForgeEvent(
  kind: string,
  payload: Record<string, unknown> | null,
): string {
  if (!payload) return "";
  if (kind === "tool_use") {
    const tool = payload.tool ?? payload.name ?? "?";
    const input = payload.inputSummary ?? "";
    return `${tool}${input ? `: ${input}` : ""}`;
  }
  if (kind === "tool_result") {
    return payload.isError
      ? `error: ${String(payload.preview ?? "").slice(0, 80)}`
      : String(payload.preview ?? "").slice(0, 80);
  }
  if (kind === "assistant_text") {
    return String(payload.text ?? "").slice(0, 120);
  }
  if (kind === "story_picked") return `picked: ${payload.storyId ?? ""}`;
  if (kind === "story_done") return payload.ok ? `✓ done` : `✗ failed`;
  if (kind === "error") return `error: ${String(payload.message ?? "")}`;
  return "";
}

/**
 * Maps each PRD reference to its Forge run state.
 *
 * Strategy:
 * 1. Baseline: lê `ProductRequirement.lastRun*` (mantido em sync por trigger AFTER UPDATE
 *    em ForgeRun.status). Isso garante que PRDs concluídos em runs anteriores
 *    NÃO esquecem o status (Bug B fix).
 * 2. Overlay: pra PRDs cobertos pelo run ativo (queued/running) — sobrepõe com
 *    estado live derivado dos eventos.
 *
 * Single source of truth para run-state — compartilhado entre o kanban endpoint
 * e `getProjectForgeSummary` (Forge tab PRD list).
 */
export async function derivePrdRunInfo(
  supabase: ReturnType<typeof db>,
  projectId: string,
  references: string[],
): Promise<Map<string, PrdRunInfo>> {
  const result = new Map<string, PrdRunInfo>();
  for (const ref of references) {
    result.set(ref, {
      runState: "idle",
      runId: null,
      currentPhase: null,
      startedAt: null,
      finishedAt: null,
      durationMs: null,
      lastEvents: [],
    });
  }
  if (references.length === 0) return result;

  // 1. Baseline: lastRun* persistido em ProductRequirement (mantido por trigger).
  const { data: prdRows } = await supabase
    .from("ProductRequirement")
    .select('reference, "lastRunId", "lastRunStatus", "lastRunFinishedAt"')
    .eq("projectId", projectId)
    .in("reference", references);

  for (const row of prdRows ?? []) {
    if (!row.lastRunStatus) continue;
    const runState: PrdRunState =
      row.lastRunStatus === "done"
        ? "done"
        : row.lastRunStatus === "error" || row.lastRunStatus === "aborted"
          ? "failed"
          : "idle";
    result.set(row.reference, {
      runState,
      runId: row.lastRunId,
      currentPhase: null,
      startedAt: null,
      finishedAt: row.lastRunFinishedAt,
      durationMs: null,
      lastEvents: [],
    });
  }

  // 2. Overlay: estado live do run ativo (se há um cobrindo o PRD).
  const { data: activeRuns } = await supabase
    .from("ForgeRun")
    .select("id, status, manifest, createdAt")
    .eq("projectId", projectId)
    .in("status", ["queued", "running"])
    .order("createdAt", { ascending: false })
    .limit(1);

  const activeRun = activeRuns?.[0] ?? null;
  if (!activeRun) return result;

  const manifest = activeRun.manifest as { prds?: ManifestPrdRef[] } | null;
  const activeRefs = new Set(
    (manifest?.prds ?? [])
      .map((p) => p.reference)
      .filter((r): r is string => !!r),
  );

  const { data: rawEvents } = await supabase
    .from("ForgeEvent")
    .select("runId, taskId, kind, ts, payload")
    .eq("runId", activeRun.id)
    .order("seq", { ascending: true });

  const eventsByStory = new Map<string, RunEventRow[]>();
  for (const ev of (rawEvents ?? []) as Array<
    RunEventRow & { runId: string; taskId: string | null }
  >) {
    const storyId =
      (ev.payload &&
      typeof (ev.payload as { storyId?: unknown }).storyId === "string"
        ? (ev.payload as { storyId: string }).storyId
        : null) ??
      ev.taskId ??
      null;
    if (!storyId) continue;
    const list = eventsByStory.get(storyId) ?? [];
    list.push({ kind: ev.kind, ts: ev.ts, payload: ev.payload });
    eventsByStory.set(storyId, list);
  }

  for (const reference of references) {
    if (!activeRefs.has(reference)) continue;

    const evs = eventsByStory.get(reference) ?? [];

    let runState: PrdRunState = "pending";
    let currentPhase: string | null = null;
    let startedAt: string | null = null;
    let finishedAt: string | null = null;

    for (const ev of evs) {
      if (ev.kind === "story_picked") {
        runState = "running";
        startedAt = startedAt ?? ev.ts;
      } else if (ev.kind === "story_done") {
        const pl = ev.payload as { ok?: unknown; passes?: unknown } | null;
        const ok = pl?.passes === true || pl?.ok === true;
        runState = ok ? "done" : "failed";
        finishedAt = ev.ts;
      } else if (ev.kind === "story_failed") {
        runState = "failed";
        finishedAt = ev.ts;
      }
      currentPhase = ev.kind;
    }

    const lastEvents = evs
      .slice(-15)
      .map((ev) => ({
        kind: ev.kind,
        ts: ev.ts,
        summary: summarizeForgeEvent(ev.kind, ev.payload),
      }))
      .filter((e) => e.summary.length > 0)
      .slice(-5);

    const durationMs =
      startedAt && finishedAt
        ? new Date(finishedAt).getTime() - new Date(startedAt).getTime()
        : startedAt && runState === "running"
          ? Date.now() - new Date(startedAt).getTime()
          : null;

    result.set(reference, {
      runState,
      runId: activeRun.id,
      currentPhase,
      startedAt,
      finishedAt,
      durationMs,
      lastEvents,
    });
  }

  return result;
}

export type ProjectForgeSummary = {
  /** PRDs do banco (snapshot live da source session). Vazio quando forgeSourceSessionId é null. */
  dbPrds: ForgePrdItem[];
  /** ID da DesignSession carregada como source da Forja deste projeto, ou null. */
  forgeSourceSessionId: string | null;
  /** Top 5 runs (newest first). */
  runs: ForgeRunRow[];
  /** Run em queued/running, se existe. */
  activeRun: ForgeRunRow | null;
  /** Último run completed ou failed, se existe. */
  lastFinishedRun: ForgeRunRow | null;
  /** PRD references que falharam no último run finalizado (pra retry seletivo). */
  lastFinishedRunFailedPrdRefs: string[];
  /** Sum de costUsdTotal nos últimos 7 dias. */
  cost7d: number;
  /** Count de runs nos últimos 7 dias. */
  runCount7d: number;
};

export type LoadableSession = {
  id: string;
  title: string;
  subKind: string | null;
  status: string;
  isMain: boolean;
  prdTotal: number;
  prdReady: number;
  createdAt: string;
};

// ─── Reads ────────────────────────────────────────────────────────────────────

/**
 * Lista DesignSessions tipo `prd_session` do projeto, com counts de PRDs.
 * Ordenada: Main primeiro, depois createdAt desc.
 */
export async function getLoadableSessions(
  projectId: string,
): Promise<LoadableSession[]> {
  const supabase = db();

  // Toda DesignSession do projeto — não só `prd_session`. PRDs podem nascer
  // direto de uma Inception (type=super/inception), então qualquer session que
  // segure ≥1 PRD é "loadable". `prd_session` aparece sempre (mesmo vazia) pra
  // não quebrar o fluxo de carregar uma session recém-criada.
  const { data: sessions, error } = await supabase
    .from("DesignSession")
    .select("id, title, subKind, type, status, isMain, createdAt")
    .eq("projectId", projectId)
    .order("createdAt", { ascending: false });
  if (error) throw error;

  const sessionIds = (sessions ?? []).map((s) => s.id);
  if (sessionIds.length === 0) return [];

  const { data: prds, error: prdErr } = await supabase
    .from("ProductRequirement")
    .select("designSessionId, status")
    .in("designSessionId", sessionIds)
    .is("dismissedAt", null);
  if (prdErr) throw prdErr;

  const totals = new Map<string, { total: number; ready: number }>();
  for (const sid of sessionIds) totals.set(sid, { total: 0, ready: 0 });
  for (const p of prds ?? []) {
    if (!p.designSessionId) continue;
    const t = totals.get(p.designSessionId);
    if (!t) continue;
    t.total += 1;
    if (p.status === "approved" || p.status === "ready") t.ready += 1;
  }

  const items: LoadableSession[] = (sessions ?? [])
    // Mantém: prd_session (sempre) + qualquer session com PRDs (ex: Inception).
    .filter((s) => s.type === "prd_session" || (totals.get(s.id)?.total ?? 0) > 0)
    .map((s) => {
      const t = totals.get(s.id) ?? { total: 0, ready: 0 };
      return {
        id: s.id,
        title: s.title,
        subKind: s.subKind,
        status: s.status,
        isMain: s.isMain,
        prdTotal: t.total,
        prdReady: t.ready,
        createdAt: s.createdAt,
      };
    });

  // Main primeiro
  items.sort((a, b) => {
    if (a.isMain && !b.isMain) return -1;
    if (!a.isMain && b.isMain) return 1;
    return 0;
  });

  return items;
}

/**
 * Resume da tab Forge. A Forja é DB-only: PRDs vêm exclusivamente da source
 * session carregada (`forgeSourceSessionId`). Sem session carregada, dbPrds é
 * vazio e a UI pede pra carregar uma session — não há mais fallback filesystem.
 */
export async function getProjectForgeSummary(
  projectId: string,
): Promise<ProjectForgeSummary> {
  const supabase = db();

  const { data: project, error: projectError } = await supabase
    .from("Project")
    .select("name, forgeSourceSessionId")
    .eq("id", projectId)
    .maybeSingle();
  if (projectError) throw projectError;
  if (!project) throw new Error(`Project ${projectId} not found`);

  let dbPrds: ForgePrdItem[] = [];

  if (project.forgeSourceSessionId) {
    const rows = await getPrdsForSession(project.forgeSourceSessionId);
    const runInfo = await derivePrdRunInfo(
      supabase,
      projectId,
      rows.map((r) => r.reference),
    );
    dbPrds = rows.map((r) =>
      prdRowToItem(r, runInfo.get(r.reference)?.runState ?? "idle"),
    );
  }

  const { data: runs, error: runsError } = await supabase
    .from("ForgeRun")
    .select("*")
    .eq("projectId", projectId)
    .order("createdAt", { ascending: false })
    .limit(5);
  if (runsError) throw runsError;

  const runsList = runs ?? [];
  const activeRun =
    runsList.find((r) => r.status === "queued" || r.status === "running") ??
    null;
  const lastFinishedRun =
    runsList.find(
      (r) =>
        r.status === "done" ||
        r.status === "error" ||
        r.status === "aborted",
    ) ?? null;

  // Pra retry seletivo: cruza manifest do último run com ForgeEvent pra achar
  // quais PRD.references falharam.
  let lastFinishedRunFailedPrdRefs: string[] = [];
  if (lastFinishedRun) {
    const manifest = lastFinishedRun.manifest as {
      prds?: Array<{ reference?: string }>;
    } | null;
    const manifestRefs = (manifest?.prds ?? [])
      .map((p) => p.reference)
      .filter((r): r is string => !!r);

    if (manifestRefs.length > 0) {
      const { data: events } = await supabase
        .from("ForgeEvent")
        .select("kind, payload")
        .eq("runId", lastFinishedRun.id)
        .in("kind", ["story_done", "story_failed"]);

      const failedRefs = new Set<string>();
      const doneRefs = new Set<string>();
      for (const ev of events ?? []) {
        const sid =
          typeof ev.payload === "object" &&
          ev.payload !== null &&
          "storyId" in ev.payload &&
          typeof (ev.payload as { storyId: unknown }).storyId === "string"
            ? ((ev.payload as { storyId: string }).storyId)
            : null;
        if (!sid) continue;
        if (ev.kind === "story_failed") {
          failedRefs.add(sid);
        } else if (ev.kind === "story_done") {
          const ok =
            typeof ev.payload === "object" &&
            ev.payload !== null &&
            "ok" in ev.payload &&
            (ev.payload as { ok: unknown }).ok === true;
          if (ok) doneRefs.add(sid);
          else failedRefs.add(sid);
        }
      }
      // PRDs sem nenhum evento de done também contam como "não passou"
      // se o run terminou (cancelled/failed). Mas pra retry seletivo,
      // priorizamos só os explicitamente falhados — manifestRefs sem
      // done event ficam pra próximo run completo.
      lastFinishedRunFailedPrdRefs = manifestRefs.filter((r) =>
        failedRefs.has(r),
      );
    }
  }

  const now = new Date();
  const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

  const { data: recentRuns, error: recentError } = await supabase
    .from("ForgeRun")
    .select("costUsdTotal, createdAt")
    .eq("projectId", projectId)
    .gte("createdAt", sevenDaysAgo.toISOString());
  if (recentError) throw recentError;

  const cost7d = (recentRuns ?? []).reduce(
    (sum, run) => sum + (run.costUsdTotal ?? 0),
    0,
  );
  const runCount7d = (recentRuns ?? []).length;

  return {
    dbPrds,
    forgeSourceSessionId: project.forgeSourceSessionId ?? null,
    runs: runsList,
    activeRun,
    lastFinishedRun,
    lastFinishedRunFailedPrdRefs,
    cost7d,
    runCount7d,
  };
}

function prdRowToItem(
  p: ProductRequirementRow,
  runState: PrdRunState = "idle",
): ForgePrdItem {
  const ac = Array.isArray(p.acceptanceCriteria)
    ? (p.acceptanceCriteria as unknown[])
    : [];
  return {
    id: p.id,
    reference: p.reference,
    title: p.title,
    status: p.status,
    oneLiner: p.oneLiner ?? "",
    acCount: ac.length,
    runState,
  };
}

// ─── Mutations ────────────────────────────────────────────────────────────────

/**
 * Marca uma DesignSession como source da Forja pra um Project.
 * Valida: session existe + pertence ao mesmo projeto + tem ≥ 1 PRD aprovado.
 */
export async function setForgeSourceSession(args: {
  projectId: string;
  designSessionId: string | null;
}): Promise<void> {
  const { projectId, designSessionId } = args;
  const supabase = db();

  if (designSessionId !== null) {
    const { data: session, error } = await supabase
      .from("DesignSession")
      .select("id, projectId, type")
      .eq("id", designSessionId)
      .maybeSingle();
    if (error) throw error;
    if (!session) {
      throw new Error(`DesignSession ${designSessionId} not found`);
    }
    if (session.projectId !== projectId) {
      throw new Error(
        `DesignSession ${designSessionId} doesn't belong to project ${projectId}`,
      );
    }
    if (session.type !== "prd_session") {
      throw new Error(
        `DesignSession ${designSessionId} type is "${session.type}" — only "prd_session" can be loaded into Forja.`,
      );
    }
  }

  const { error: updErr } = await supabase
    .from("Project")
    .update({ forgeSourceSessionId: designSessionId })
    .eq("id", projectId);
  if (updErr) throw updErr;
}

// ─── Run creation (snapshot manifest) ────────────────────────────────────────

type ManifestStory = {
  id: string;
  title: string;
  description?: string;
  acceptanceCriteria: string[];
  verifiable: Array<{ kind: string; command_or_query: string; expected: string }>;
  dependsOn: string[];
  agentProfile?: string;
  estimateMinutes?: number;
  touches?: string[];
};

type ManifestPrd = {
  id: string;
  reference: string;
  title: string;
  problem: string;
  goal: string;
  oneLiner: string;
  acceptanceCriteria: unknown[];
  stories: ManifestStory[];
};

export type ForgeRunManifest = {
  version: 1;
  snapshotAt: string;
  sourceSessionId: string;
  prds: ManifestPrd[];
};

/** Ordena os PRDs topologicamente por ProductRequirement.dependencies (prdId),
 *  pra que a ordem do snapshot respeite deps cross-PRD. Deps fora do conjunto
 *  elegível são ignoradas. Ciclo/sobra → mantém ordem de entrada (estável). */
function topoSortByDependencies(
  prds: ProductRequirementRow[],
): ProductRequirementRow[] {
  const byId = new Map(prds.map((p) => [p.id, p]));
  const indeg = new Map(prds.map((p) => [p.id, 0]));
  const adj = new Map<string, string[]>(prds.map((p) => [p.id, []]));
  for (const p of prds) {
    const deps = Array.isArray(p.dependencies)
      ? (p.dependencies as Array<Record<string, unknown>>)
      : [];
    for (const d of deps) {
      const pid =
        d && typeof d === "object" && typeof d.prdId === "string"
          ? d.prdId
          : null;
      if (!pid || !byId.has(pid)) continue;
      // O `kind` codifica a DIREÇÃO da aresta — não dá pra ignorá-lo:
      //   • `depends_on`: o dono (p) depende de prdId → prdId vem ANTES de p.
      //   • `blocks` / `enables`: o dono (p) é pré-requisito → p vem ANTES de prdId.
      //   • `shares-data` / não-direcional: ignora (não impõe ordem).
      const kind = String((d as Record<string, unknown>).kind ?? "depends_on")
        .toLowerCase()
        .replace(/-/g, "_");
      let before: string;
      let after: string;
      if (kind === "blocks" || kind === "enables") {
        before = p.id;
        after = pid;
      } else if (kind === "shares_data") {
        continue;
      } else {
        // depends_on (default seguro p/ kinds desconhecidos)
        before = pid;
        after = p.id;
      }
      adj.get(before)!.push(after);
      indeg.set(after, (indeg.get(after) ?? 0) + 1);
    }
  }
  const queue = prds.filter((p) => (indeg.get(p.id) ?? 0) === 0).map((p) => p.id);
  const out: ProductRequirementRow[] = [];
  const seen = new Set<string>();
  while (queue.length > 0) {
    const id = queue.shift()!;
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(byId.get(id)!);
    for (const n of adj.get(id) ?? []) {
      indeg.set(n, (indeg.get(n) ?? 1) - 1);
      if ((indeg.get(n) ?? 0) === 0) queue.push(n);
    }
  }
  if (out.length < prds.length) {
    for (const p of prds) if (!seen.has(p.id)) out.push(p);
  }
  return out;
}

/** Mapeia uma story rica (jsonb de ProductRequirement.stories) pro shape do
 *  manifest consumido por exec-forge-run/exec-forge-story. */
function toManifestStory(s: Record<string, unknown>): ManifestStory {
  return {
    id: String(s.id ?? ""),
    title: String(s.title ?? s.id ?? ""),
    description: typeof s.description === "string" ? s.description : undefined,
    acceptanceCriteria: Array.isArray(s.acceptanceCriteria)
      ? (s.acceptanceCriteria as unknown[]).map(String)
      : [],
    verifiable: Array.isArray(s.verifiable)
      ? (s.verifiable as ManifestStory["verifiable"])
      : [],
    dependsOn: Array.isArray(s.dependsOn)
      ? (s.dependsOn as unknown[]).map(String)
      : [],
    agentProfile: typeof s.agentProfile === "string" ? s.agentProfile : undefined,
    estimateMinutes:
      typeof s.estimateMinutes === "number" ? s.estimateMinutes : undefined,
    touches: Array.isArray(s.touches)
      ? (s.touches as unknown[]).map(String)
      : undefined,
  };
}

/**
 * Snapshot dos PRDs aprovados de uma session pro formato consumido pelo worker.
 *
 * Se o PRD tem `stories` rico (com verifiable), emite **1 manifest story por
 * item** (granular, self-verifying). Se `stories` está vazio, faz fallback ao
 * comportamento legado: 1 story por PRD com AC = acceptanceCriteria (sem
 * verifiable). PRDs são ordenados topologicamente por dependencies.
 */
export function snapshotManifest(
  sessionId: string,
  prds: ProductRequirementRow[],
): ForgeRunManifest {
  const snapshotAt = new Date().toISOString();
  const ordered = topoSortByDependencies(prds);
  return {
    version: 1,
    snapshotAt,
    sourceSessionId: sessionId,
    prds: ordered.map((p) => {
      const acRaw = Array.isArray(p.acceptanceCriteria)
        ? (p.acceptanceCriteria as Array<Record<string, unknown>>)
        : [];
      const richStories = Array.isArray(p.stories)
        ? (p.stories as Array<Record<string, unknown>>)
        : [];
      const stories: ManifestStory[] =
        richStories.length > 0
          ? richStories.map(toManifestStory)
          : [
              {
                id: p.reference,
                title: p.title,
                acceptanceCriteria: acRaw.map(stringifyAc),
                verifiable: [],
                dependsOn: [],
              },
            ];
      return {
        id: p.id,
        reference: p.reference,
        title: p.title,
        problem: p.problem ?? "",
        goal: p.goal ?? "",
        oneLiner: p.oneLiner ?? "",
        acceptanceCriteria: acRaw,
        stories,
      };
    }),
  };
}

function stringifyAc(ac: Record<string, unknown>): string {
  if (typeof ac.text === "string" && ac.text.trim()) return ac.text;
  const parts: string[] = [];
  if (typeof ac.given === "string" && ac.given) parts.push(`Dado ${ac.given}`);
  if (typeof ac.when === "string" && ac.when) parts.push(`quando ${ac.when}`);
  if (typeof ac.then === "string" && ac.then) parts.push(`então ${ac.then}`);
  return parts.length > 0 ? parts.join(", ") : JSON.stringify(ac);
}

/**
 * Cria um ForgeRun + ForgeJob a partir da source session do projeto.
 * - Snapshot dos PRDs aprovados no ForgeRun.manifest (imutável).
 * - Cria ForgeJob (status=queued) que o daemon vai claim.
 *
 * Pré-condições:
 * - Project.forgeSourceSessionId setado.
 * - Session tem ≥ 1 PRD aprovado.
 * - Project tem repoUrl setado.
 */
export async function createForgeRunFromSession(args: {
  projectId: string;
  ownerId: string;
  /** Se passado, snapshot só inclui PRDs cujo reference está nesta lista. */
  prdRefsFilter?: string[];
}): Promise<{ runId: string; jobId: string; prdCount: number }> {
  const { projectId, ownerId, prdRefsFilter } = args;
  const supabase = db();

  const { data: project, error: projErr } = await supabase
    .from("Project")
    .select("forgeSourceSessionId, repoUrl, name")
    .eq("id", projectId)
    .maybeSingle();
  if (projErr) throw projErr;
  if (!project) throw new Error(`Project ${projectId} not found`);
  if (!project.forgeSourceSessionId) {
    throw new Error("Project não tem session carregada na Forja.");
  }

  const allPrds = await getPrdsForSession(project.forgeSourceSessionId);
  let eligible = allPrds.filter(
    (p) => p.status === "approved" || p.status === "ready",
  );
  if (eligible.length === 0) {
    throw new Error(
      "Nenhum PRD aprovado nesta session — aprove ao menos 1 PRD pra rodar a Forja.",
    );
  }
  if (prdRefsFilter && prdRefsFilter.length > 0) {
    // Filtro explícito (retry de falha / re-run de PRD específico pelo painel):
    // honra exatamente o que foi pedido, mesmo PRDs já concluídos.
    const refSet = new Set(prdRefsFilter);
    eligible = eligible.filter((p) => refSet.has(p.reference));
    if (eligible.length === 0) {
      throw new Error(
        "Nenhum dos PRDs filtrados está aprovado — não há nada pra rodar.",
      );
    }
  } else {
    // Disparo "novo" sem filtro: roda só o que ainda NÃO foi concluído com
    // sucesso (idle/failed). PRDs já 'done' ficam de fora pra não re-rodar tudo
    // a cada clique. Pra re-rodar um concluído, use o botão "Disparar" no painel
    // da PRD (passa prdRefs explícito).
    eligible = eligible.filter(
      (p) =>
        (p as { lastRunStatus?: string | null }).lastRunStatus !== "done",
    );
    if (eligible.length === 0) {
      throw new Error(
        "Todos os PRDs aprovados desta session já foram concluídos — nada novo pra rodar.",
      );
    }
  }

  // FRS-004: stories ricas exigem ≥1 verifiable cada — sem check automatizável
  // o agente não tem "done" objetivo. PRDs sem `stories` (fallback legado) passam.
  const offenders: string[] = [];
  for (const p of eligible) {
    const stories = Array.isArray(p.stories)
      ? (p.stories as Array<Record<string, unknown>>)
      : [];
    for (const s of stories) {
      const v = Array.isArray(s.verifiable) ? s.verifiable : [];
      if (v.length === 0) offenders.push(`${p.reference}/${String(s.id ?? "?")}`);
    }
  }
  if (offenders.length > 0) {
    const head = offenders.slice(0, 10).join(", ");
    const more = offenders.length > 10 ? ` (+${offenders.length - 10})` : "";
    throw new Error(`story_without_verifiable: ${head}${more}`);
  }

  const manifest = snapshotManifest(project.forgeSourceSessionId, eligible);
  const runId = randomUUID();
  const title = `${project.name} — ${eligible.length} PRD${eligible.length > 1 ? "s" : ""}`;

  const { error: runErr } = await supabase.from("ForgeRun").insert({
    id: runId,
    projectId,
    ownerId,
    title,
    status: "queued",
    // CHECK aceita 'story' | 'task' | 'ad_hoc'. Usamos 'ad_hoc' pra run
    // disparado manualmente da UI (vs scheduled/cascade).
    trigger: "ad_hoc",
    designSessionId: project.forgeSourceSessionId,
    manifest: manifest as unknown as Json,
    repoUrl: project.repoUrl,
  });
  if (runErr) throw runErr;

  // ForgeJob.prdSlug é obrigatório (NOT NULL). Em modo session, usamos o
  // reference do 1º PRD como slug-identificador legível pelo daemon — mas o
  // worker vai ler o manifest do ForgeRun via runId, não do FS.
  const slugHint = eligible[0].reference.toLowerCase();
  // Piloto: assignToAnyone=true pra qualquer daemon registrado pegar o job.
  // No daemon auth real (post-piloto), trocaríamos por matching de ownerId.
  const job = await createJob({
    ownerId,
    prdSlug: slugHint,
    projectId,
    runId,
    status: "queued",
    assignToAnyone: true,
  });

  return { runId, jobId: job.id, prdCount: eligible.length };
}
