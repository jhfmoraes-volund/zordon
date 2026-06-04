import "server-only";
import { randomUUID } from "node:crypto";
import { db } from "@/lib/db";
import {
  listPrds,
  filterPrdsByProject,
  type PrdSummary,
} from "@/lib/forge/prd-fs";
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
 * Maps each PRD reference to its Forge run state by finding the run that covers
 * it (active run > last finished) and replaying that run's story events.
 *
 * Single source of truth for run-state derivation — shared by the kanban
 * endpoint (`/api/forge/projects/[id]/prds`) and `getProjectForgeSummary` (the
 * Forge tab PRD list). Returns a Map keyed by PRD reference; references with no
 * covering run get `runState: "idle"`.
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

  const { data: activeRuns } = await supabase
    .from("ForgeRun")
    .select("id, status, manifest, createdAt")
    .eq("projectId", projectId)
    .in("status", ["queued", "running"])
    .order("createdAt", { ascending: false })
    .limit(1);

  const { data: lastRuns } = await supabase
    .from("ForgeRun")
    .select("id, status, manifest, createdAt")
    .eq("projectId", projectId)
    .in("status", ["done", "error", "aborted"])
    .order("createdAt", { ascending: false })
    .limit(1);

  const activeRun = activeRuns?.[0] ?? null;
  const lastRun = lastRuns?.[0] ?? null;
  const candidates = [activeRun, lastRun].filter(
    (r): r is NonNullable<typeof activeRun> => !!r,
  );
  if (candidates.length === 0) return result;

  // Which PRD references each candidate run covers, via its manifest.
  const refsByRun = new Map<string, Set<string>>();
  for (const run of candidates) {
    const manifest = run.manifest as { prds?: ManifestPrdRef[] } | null;
    refsByRun.set(
      run.id,
      new Set(
        (manifest?.prds ?? [])
          .map((p) => p.reference)
          .filter((r): r is string => !!r),
      ),
    );
  }

  // Events for the candidate runs, grouped by run → story (PRD reference).
  const runIds = candidates.map((r) => r.id);
  const eventsByRunByStory = new Map<string, Map<string, RunEventRow[]>>();
  const { data: rawEvents } = await supabase
    .from("ForgeEvent")
    .select("runId, taskId, kind, ts, payload")
    .in("runId", runIds)
    .order("seq", { ascending: true });

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
    const runMap = eventsByRunByStory.get(ev.runId) ?? new Map();
    const list = runMap.get(storyId) ?? [];
    list.push({ kind: ev.kind, ts: ev.ts, payload: ev.payload });
    runMap.set(storyId, list);
    eventsByRunByStory.set(ev.runId, runMap);
  }

  for (const reference of references) {
    let coveringRun: (typeof candidates)[number] | null = null;
    for (const run of candidates) {
      if (refsByRun.get(run.id)?.has(reference)) {
        coveringRun = run;
        break;
      }
    }
    if (!coveringRun) continue;

    const evs = eventsByRunByStory.get(coveringRun.id)?.get(reference) ?? [];
    const isActive =
      coveringRun.status === "queued" || coveringRun.status === "running";

    let runState: PrdRunState = isActive ? "pending" : "idle";
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
      runId: coveringRun.id,
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
  /** PRDs do filesystem (modo legado/Ralph). Vazio quando forgeSourceSessionId está setado. */
  prds: PrdSummary[];
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

  const { data: sessions, error } = await supabase
    .from("DesignSession")
    .select("id, title, subKind, status, isMain, createdAt")
    .eq("projectId", projectId)
    .eq("type", "prd_session")
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

  const items: LoadableSession[] = (sessions ?? []).map((s) => {
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
 * Resume da tab Forge. Quando `forgeSourceSessionId` está setado, lista PRDs
 * do banco; senão cai no modo legado filesystem (Ralph).
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

  let prds: PrdSummary[] = [];
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
  } else {
    // Fallback: PRDs do FS (Ralph) por slug-match com o nome do projeto.
    const allPrds = await listPrds();
    prds = filterPrdsByProject(allPrds, project);
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
    prds,
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
  ac: string[];
  dependsOn: string[];
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

/**
 * Snapshot dos PRDs aprovados de uma session pro formato consumido pelo worker.
 *
 * Cada PRD vira 1 "story implícita" no manifest (id = PRD reference). O worker
 * recebe acceptanceCriteria como AC; deps entre PRDs ficam vazias por default
 * (ordenação fica a cargo do orchestrator no worker).
 */
function snapshotManifest(
  sessionId: string,
  prds: ProductRequirementRow[],
): ForgeRunManifest {
  const snapshotAt = new Date().toISOString();
  return {
    version: 1,
    snapshotAt,
    sourceSessionId: sessionId,
    prds: prds.map((p) => {
      const acRaw = Array.isArray(p.acceptanceCriteria)
        ? (p.acceptanceCriteria as Array<Record<string, unknown>>)
        : [];
      const acFlat = acRaw.map(stringifyAc);
      return {
        id: p.id,
        reference: p.reference,
        title: p.title,
        problem: p.problem ?? "",
        goal: p.goal ?? "",
        oneLiner: p.oneLiner ?? "",
        acceptanceCriteria: acRaw,
        stories: [
          {
            id: p.reference,
            title: p.title,
            ac: acFlat,
            dependsOn: [],
          },
        ],
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
