import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireCapabilityApi } from "@/lib/access/require-capability";
import { getSession, updateStatus } from "@/lib/dal/planning-session";
import {
  runPlanningOrchestrateJob,
  type PlanningOrchestratJobInput,
} from "@/lib/jobs/planning-orchestrate-job";

export const maxDuration = 300;

const orchestrateSchema = z.object({
  targetVersion: z.enum(["v1", "v2", "v3"]).optional(),
});

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: sessionId } = await params;

  // Validate session exists and is in draft
  const session = await getSession(sessionId);
  if (!session) {
    return NextResponse.json({ error: "session not found" }, { status: 404 });
  }

  // db() bypassa RLS — orquestrar é operar o Planning (grant-aware).
  const denied = await requireCapabilityApi("ritual.planning", {
    projectId: session.projectId,
  });
  if (denied) return denied;

  if (session.status !== "draft") {
    return NextResponse.json(
      {
        error: "session not in draft",
        currentStatus: session.status,
      },
      { status: 409 },
    );
  }

  const body = await req.json().catch(() => ({}));
  const parsed = orchestrateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const targetVersion = parsed.data.targetVersion ?? "v1";

  // Update status to orchestrating
  await updateStatus(sessionId, "orchestrating");

  // Run the job directly (no separate job table for now)
  // In production, this would kick off a background worker
  const input: PlanningOrchestratJobInput = {
    sessionId,
    targetVersion,
  };

  // For the MVP, we run this synchronously and return the result
  // In the future, this would spawn a background job and return 202 with jobId
  try {
    const result = await runPlanningOrchestrateJob(input);

    if (!result.success) {
      return NextResponse.json(
        {
          error: result.error ?? "orchestration failed",
          result,
        },
        { status: 500 },
      );
    }

    return NextResponse.json(
      {
        ok: true,
        sessionId,
        result,
      },
      { status: 200 }, // 200 for sync completion, 202 for async
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : "orchestration failed";
    await updateStatus(sessionId, "error", { errorMessage: msg });
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
