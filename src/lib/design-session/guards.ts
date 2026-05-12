import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getStepsForSession } from "@/lib/design-session-steps";
import { isStepKey, type StepKey } from "./types";

/**
 * Verifies that `stepKey` is a valid step within the given session.
 * For "super" sessions, this checks against `selectedSteps`; for other types,
 * the preset for that type. Returns null on success, or a NextResponse with
 * 400 (bad key) / 404 (session not found) / 409 (key not in session).
 */
export async function assertStepInSession(
  sessionId: string,
  stepKey: string,
): Promise<{ stepKey: StepKey } | NextResponse> {
  if (!isStepKey(stepKey)) {
    return NextResponse.json({ error: `Unknown stepKey: ${stepKey}` }, { status: 400 });
  }
  const { data: session } = await db()
    .from("DesignSession")
    .select("type, selectedSteps")
    .eq("id", sessionId)
    .maybeSingle();
  if (!session) {
    return NextResponse.json({ error: "Session not found" }, { status: 404 });
  }
  const steps = getStepsForSession({
    type: session.type,
    selectedSteps: session.selectedSteps ?? null,
  });
  if (!steps.some((s) => s.key === stepKey)) {
    return NextResponse.json(
      { error: `Step "${stepKey}" not active in this session` },
      { status: 409 },
    );
  }
  return { stepKey };
}
