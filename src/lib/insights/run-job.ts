import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";

import { loadInsightContext } from "./load-context";
import {
  relationalSystemPrompt,
  relationalUserPayload,
  technicalSystemPrompt,
  technicalUserPayload,
} from "./prompts";
import {
  relationalAnalysisSchema,
  technicalAnalysisSchema,
  type RelationalAnalysis,
  type TechnicalAnalysis,
} from "./schemas";
import { callOpenRouterJson } from "./llm";

type Client = SupabaseClient<Database>;

const DEFAULT_MODEL = "anthropic/claude-sonnet-4.6";

function modelRelational() {
  return process.env.INSIGHTS_MODEL_RELATIONAL ?? DEFAULT_MODEL;
}
function modelTechnical() {
  return process.env.INSIGHTS_MODEL_TECHNICAL ?? DEFAULT_MODEL;
}

export type RunJobResult = {
  jobId: string;
  projectId: string;
  ok: boolean;
  durationMs: number;
  errorRelational?: string;
  errorTechnical?: string;
};

export type ClaimedJob = {
  id: string;
  kind: "project" | "client";
  projectId: string | null;
  clientId: string | null;
  triggeredByMemberId: string | null;
  source: "cron" | "manual";
};

const CLAIM_COLS = "id, kind, projectId, clientId, triggeredByMemberId, source";

/** Atomically claim a single pending job (any kind). Returns null if none. */
export async function claimNextJob(admin: Client, jobId?: string): Promise<ClaimedJob | null> {
  if (jobId) {
    const { data } = await admin
      .from("InsightJob")
      .update({ status: "running", startedAt: new Date().toISOString() })
      .eq("id", jobId)
      .eq("status", "pending")
      .select(CLAIM_COLS)
      .single();
    return (data as ClaimedJob | null) ?? null;
  }

  const { data: candidate } = await admin
    .from("InsightJob")
    .select(CLAIM_COLS)
    .eq("status", "pending")
    .order("createdAt", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (!candidate) return null;

  const { data: claimed } = await admin
    .from("InsightJob")
    .update({ status: "running", startedAt: new Date().toISOString() })
    .eq("id", candidate.id)
    .eq("status", "pending")
    .select(CLAIM_COLS)
    .single();

  return (claimed as ClaimedJob | null) ?? null;
}

async function finishJob(
  admin: Client,
  jobId: string,
  status: "done" | "failed",
  error?: string,
) {
  await admin
    .from("InsightJob")
    .update({
      status,
      finishedAt: new Date().toISOString(),
      error: error ?? null,
    })
    .eq("id", jobId);
}

/**
 * Process one claimed *project-kind* job end-to-end:
 *   load context → 2 LLM calls in parallel → upsert ProjectInsight → mark done.
 *
 * One LLM call can fail without failing the whole job — the failed half's
 * error is stashed on the row and the other half still lands. The job is only
 * marked `failed` if the *infrastructure* failed (couldn't load context, or
 * couldn't upsert the row).
 *
 * For client-kind jobs see runClientInsightJob in run-client-job.ts.
 */
export async function runInsightJob(
  admin: Client,
  job: ClaimedJob,
): Promise<RunJobResult> {
  if (job.kind !== "project" || !job.projectId) {
    throw new Error(
      `runInsightJob called with non-project job ${job.id} (kind=${job.kind})`,
    );
  }
  const projectId = job.projectId;
  const t0 = Date.now();
  const result: RunJobResult = {
    jobId: job.id,
    projectId,
    ok: false,
    durationMs: 0,
  };

  let ctx;
  try {
    ctx = await loadInsightContext(admin, projectId);
  } catch (e) {
    const msg = (e as Error).message;
    await finishJob(admin, job.id, "failed", `load_context: ${msg}`);
    result.durationMs = Date.now() - t0;
    return result;
  }

  const relationalCall = callOpenRouterJson({
    model: modelRelational(),
    systemPrompt: relationalSystemPrompt(ctx.project.name),
    userPrompt: relationalUserPayload({
      projectName: ctx.project.name,
      clientName: ctx.project.client?.name ?? null,
      status: ctx.project.status,
      daysElapsed: ctx.project.daysElapsed,
      meetings: ctx.meetingsForRelational,
    }),
  });

  const technicalCall = callOpenRouterJson({
    model: modelTechnical(),
    systemPrompt: technicalSystemPrompt(ctx.project.name),
    userPrompt: technicalUserPayload({
      project: ctx.project,
      activeSprint: ctx.activeSprint,
      recentSprints: ctx.recentSprints,
      members: ctx.members,
      sprintAlerts: ctx.sprintAlerts,
    }),
  });

  const [relRes, techRes] = await Promise.allSettled([relationalCall, technicalCall]);

  let relational: RelationalAnalysis | null = null;
  let modelRel: string | null = null;
  let relCost = 0;
  if (relRes.status === "fulfilled") {
    const parsed = relationalAnalysisSchema.safeParse(relRes.value.parsed);
    if (parsed.success) {
      relational = parsed.data;
      modelRel = relRes.value.model;
      relCost = relRes.value.usage.cost ?? 0;
    } else {
      result.errorRelational = `validate: ${parsed.error.issues[0]?.message ?? "unknown"}`;
    }
  } else {
    result.errorRelational = relRes.reason instanceof Error
      ? relRes.reason.message
      : String(relRes.reason);
  }

  let technical: TechnicalAnalysis | null = null;
  let modelTech: string | null = null;
  let techCost = 0;
  if (techRes.status === "fulfilled") {
    const parsed = technicalAnalysisSchema.safeParse(techRes.value.parsed);
    if (parsed.success) {
      technical = parsed.data;
      modelTech = techRes.value.model;
      techCost = techRes.value.usage.cost ?? 0;
    } else {
      result.errorTechnical = `validate: ${parsed.error.issues[0]?.message ?? "unknown"}`;
    }
  } else {
    result.errorTechnical = techRes.reason instanceof Error
      ? techRes.reason.message
      : String(techRes.reason);
  }

  // OpenRouter returns USD as decimal (e.g. 0.0123). Persist in integer cents.
  const costUsdCents = Math.round((relCost + techCost) * 100);

  const upsertPayload = {
    projectId,
    generatedAt: new Date().toISOString(),
    generatedBy: job.source,
    triggeredByMemberId: job.triggeredByMemberId,

    relationalHealth: relational?.health ?? null,
    relationalSummary: relational?.summary ?? null,
    relationalSignals: relational?.signals ?? [],
    relationalWatch: relational?.watch ?? [],
    errorRelational: result.errorRelational ?? null,

    technicalHealth: technical?.health ?? null,
    technicalSummary: technical?.summary ?? null,
    technicalRisks: technical?.risks ?? [],
    technicalWatch: technical?.watch ?? [],
    errorTechnical: result.errorTechnical ?? null,

    modelRelational: modelRel,
    modelTechnical: modelTech,
    inputMeetingsCount: ctx.meetingsForRelational.length,
    inputSprintId: ctx.activeSprint?.id ?? null,
    costUsdCents,
  };

  const { error: upsertErr } = await admin
    .from("ProjectInsight")
    .upsert(upsertPayload, { onConflict: "projectId" });

  if (upsertErr) {
    await finishJob(admin, job.id, "failed", `upsert: ${upsertErr.message}`);
    result.durationMs = Date.now() - t0;
    return result;
  }

  await finishJob(admin, job.id, "done");
  result.ok = true;
  result.durationMs = Date.now() - t0;
  return result;
}
