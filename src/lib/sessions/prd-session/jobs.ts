import "server-only";
import { db } from "@/lib/db";
import { createPrd } from "@/lib/dal/product-requirements";
import { generatePrdsFromBrief } from "@/lib/agent/vitor/prompts/prd-quickask";
import type { Database } from "@/lib/supabase/database.types";
import crypto from "crypto";

type Tables = Database["public"]["Tables"];

export type PrdQuickAskJobInput = {
  sessionId: string;
  projectId: string;
  brief: string;
  actorMemberId: string;
};

export type PrdQuickAskJobResult = {
  jobId: string;
  sessionId: string;
  success: boolean;
  prdCount: number;
  error?: string;
};

/**
 * Worker que processa um job de PRD quick-ask:
 *   1. Marca job como 'running'
 *   2. Chama Vitor pra gerar PRDs do brief
 *   3. Cria ProductRequirement rows (status=draft)
 *   4. Marca job como 'done' ou 'failed'
 *
 * Pattern: InsightJob worker em src/lib/insights/run-client-job.ts
 */
export async function runPrdQuickAskJob(
  jobId: string,
): Promise<PrdQuickAskJobResult> {
  const supabase = db();
  const t0 = Date.now();

  // Fetch job details
  const { data: job, error: jobErr } = await supabase
    .from("PrdQuickAskJob")
    .select("*")
    .eq("id", jobId)
    .single();

  if (jobErr || !job) {
    throw new Error(`Job ${jobId} not found: ${jobErr?.message}`);
  }

  const result: PrdQuickAskJobResult = {
    jobId,
    sessionId: job.sessionId,
    success: false,
    prdCount: 0,
  };

  // Mark as running
  const { error: runningErr } = await supabase
    .from("PrdQuickAskJob")
    .update({
      status: "running",
      startedAt: new Date().toISOString(),
    })
    .eq("id", jobId);

  if (runningErr) {
    result.error = `Failed to mark job as running: ${runningErr.message}`;
    return result;
  }

  try {
    // Generate PRDs from brief via Vitor
    const parsedPrds = await generatePrdsFromBrief(job.brief);

    // Create ProductRequirement rows
    const createdPrds: string[] = [];
    for (const parsed of parsedPrds) {
      const prd = await createPrd({
        projectId: job.projectId,
        designSessionId: job.sessionId,
        title: parsed.title,
        problem: parsed.problem ?? "",
        goal: parsed.oneLiner ?? "",
        acceptanceCriteria: parsed.acceptanceCriteria as unknown as Database["public"]["Tables"]["ProductRequirement"]["Insert"]["acceptanceCriteria"],
        status: "draft",
        technicalNotes: "",
        actorAgent: "vitor",
        actorMemberId: job.triggeredByMemberId,
      });
      createdPrds.push(prd.id);
    }

    // Mark job as done
    await supabase
      .from("PrdQuickAskJob")
      .update({
        status: "done",
        finishedAt: new Date().toISOString(),
        prdCount: createdPrds.length,
      })
      .eq("id", jobId);

    result.success = true;
    result.prdCount = createdPrds.length;
    return result;
  } catch (error) {
    const errorMsg =
      error instanceof Error ? error.message : "Unknown error";

    // Mark job as failed
    await supabase
      .from("PrdQuickAskJob")
      .update({
        status: "failed",
        finishedAt: new Date().toISOString(),
        error: errorMsg,
      })
      .eq("id", jobId);

    result.error = errorMsg;
    return result;
  }
}

/**
 * Helper: enfileira um job de PRD quick-ask e retorna o jobId.
 * Cria a session primeiro, depois o job.
 */
export async function enqueuePrdQuickAskJob(args: {
  projectId: string;
  brief: string;
  actorMemberId: string;
}): Promise<{ sessionId: string; jobId: string }> {
  const { projectId, brief, actorMemberId } = args;
  const supabase = db();

  // Create session
  const sessionId = crypto.randomUUID();
  const nowIso = new Date().toISOString();

  const { error: sessionErr } = await supabase
    .from("DesignSession")
    .insert({
      id: sessionId,
      projectId,
      type: "prd_session",
      subKind: "quick_ask",
      title: `PRD Quick-Ask — ${brief.slice(0, 50)}${brief.length > 50 ? "..." : ""}`,
      status: "in_progress",
      currentStep: 0,
      totalSteps: 1,
      createdBy: actorMemberId,
      createdAt: nowIso,
      updatedAt: nowIso,
    });

  if (sessionErr) throw sessionErr;

  // Create job
  const jobId = crypto.randomUUID();
  const { error: jobErr } = await supabase.from("PrdQuickAskJob").insert({
    id: jobId,
    sessionId,
    projectId,
    brief,
    status: "queued",
    triggeredByMemberId: actorMemberId,
  });

  if (jobErr) throw jobErr;

  return { sessionId, jobId };
}
