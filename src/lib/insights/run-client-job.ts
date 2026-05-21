import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";

import { loadClientInsightContext } from "./load-client-context";
import {
  clientRelationalSystemPrompt,
  clientRelationalUserPayload,
  clientTechnicalSystemPrompt,
  clientTechnicalUserPayload,
} from "./client-prompts";
import {
  relationalAnalysisSchema,
  technicalAnalysisSchema,
  type RelationalAnalysis,
  type TechnicalAnalysis,
} from "./schemas";
import { callOpenRouterJson } from "./llm";
import type { ClaimedJob } from "./run-job";

type Client = SupabaseClient<Database>;

const DEFAULT_MODEL = "anthropic/claude-sonnet-4.6";

function modelRelational() {
  return process.env.INSIGHTS_MODEL_RELATIONAL ?? DEFAULT_MODEL;
}
function modelTechnical() {
  return process.env.INSIGHTS_MODEL_TECHNICAL ?? DEFAULT_MODEL;
}

export type RunClientJobResult = {
  jobId: string;
  clientId: string;
  ok: boolean;
  durationMs: number;
  errorRelational?: string;
  errorTechnical?: string;
};

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
 * Process one claimed *client-kind* job end-to-end:
 *   aggregate context across all client projects → 2 LLM calls in parallel
 *   → upsert ClientInsight → mark done.
 */
export async function runClientInsightJob(
  admin: Client,
  job: ClaimedJob,
): Promise<RunClientJobResult> {
  if (job.kind !== "client" || !job.clientId) {
    throw new Error(
      `runClientInsightJob called with non-client job ${job.id} (kind=${job.kind})`,
    );
  }
  const clientId = job.clientId;
  const t0 = Date.now();
  const result: RunClientJobResult = {
    jobId: job.id,
    clientId,
    ok: false,
    durationMs: 0,
  };

  let ctx;
  try {
    ctx = await loadClientInsightContext(admin, clientId);
  } catch (e) {
    const msg = (e as Error).message;
    await finishJob(admin, job.id, "failed", `load_context: ${msg}`);
    result.durationMs = Date.now() - t0;
    return result;
  }

  const relationalCall = callOpenRouterJson({
    model: modelRelational(),
    systemPrompt: clientRelationalSystemPrompt(ctx.client.name),
    userPrompt: clientRelationalUserPayload({
      clientName: ctx.client.name,
      projects: ctx.projects.map((p) => ({
        id: p.id,
        name: p.name,
        status: p.status,
      })),
      meetings: ctx.meetings,
    }),
  });

  const technicalCall = callOpenRouterJson({
    model: modelTechnical(),
    systemPrompt: clientTechnicalSystemPrompt(ctx.client.name),
    userPrompt: clientTechnicalUserPayload({
      clientName: ctx.client.name,
      projects: ctx.projects,
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

  const costUsdCents = Math.round((relCost + techCost) * 100);

  const upsertPayload = {
    clientId,
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
    inputProjectsCount: ctx.projects.length,
    inputMeetingsCount: ctx.meetings.length,
    costUsdCents,
  };

  const { error: upsertErr } = await admin
    .from("ClientInsight")
    .upsert(upsertPayload, { onConflict: "clientId" });

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
