import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireSessionAccessApi } from "@/lib/dal";
import { db } from "@/lib/db";
import { BRIEFING_SUB_PHASE_VALUES } from "@/lib/design-sessions/constants";

/**
 * POST /api/design-sessions/[id]/sub-phase
 *
 * Persists the briefing sub-phase + target story id in
 * DesignSessionStepData[step="briefing"].data. Vitor's loadContext reads this
 * via getStepData("briefing") and the prompt routes to the correct mode.
 * The set of valid sub-phases lives in @/lib/design-sessions/constants.
 *
 * Called by tree action buttons BEFORE sending a chat message:
 *   await fetch('/sub-phase', { body: { subPhase, targetStoryId } })
 *   sendMessage({ text: "..." })
 *
 * That ordering matters — the agent's loadContext needs the new subPhase
 * already persisted when the request arrives.
 */

const SubPhaseSchema = z.object({
  subPhase: z.enum(BRIEFING_SUB_PHASE_VALUES as unknown as [string, ...string[]]),
  targetStoryId: z.string().uuid().nullable().optional(),
});

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: sessionId } = await params;
  const denied = await requireSessionAccessApi(sessionId);
  if (denied) return denied;

  const body = await req.json().catch(() => ({}));
  const parsed = SubPhaseSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "invalid body", details: parsed.error.flatten() },
      { status: 400 },
    );
  }
  const { subPhase, targetStoryId } = parsed.data;

  const supabase = db();

  // Read current data, merge subPhase + targetStoryId, write back.
  const { data: existing } = await supabase
    .from("DesignSessionStepData")
    .select("id, data, stepIndex")
    .eq("sessionId", sessionId)
    .eq("stepKey", "briefing")
    .maybeSingle();

  const current = (existing?.data as Record<string, unknown>) ?? {};
  const next = {
    ...current,
    subPhase,
    targetStoryId: targetStoryId ?? null,
  };

  if (existing) {
    const { error } = await supabase
      .from("DesignSessionStepData")
      .update({ data: next, updatedAt: new Date().toISOString() })
      .eq("id", existing.id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  } else {
    // briefing row doesn't exist yet — create with stepIndex from session.
    const { data: session } = await supabase
      .from("DesignSession")
      .select("currentStep")
      .eq("id", sessionId)
      .single();
    const { error } = await supabase.from("DesignSessionStepData").insert({
      sessionId,
      stepKey: "briefing",
      stepIndex: session?.currentStep ?? 0,
      data: next,
      updatedAt: new Date().toISOString(),
    });
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ subPhase, targetStoryId: targetStoryId ?? null });
}
