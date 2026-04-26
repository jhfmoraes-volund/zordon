import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getCurrentMember } from "@/lib/dal";
import { TOWERS } from "@/lib/memberSkills";

/**
 * PATCH /api/profile/skills/state
 * Update the current member's assessment session.
 * Body: { lastStepIndex?: number, complete?: boolean, goals?: string }
 */
export async function PATCH(req: NextRequest) {
  const member = await getCurrentMember();
  if (!member) return new NextResponse("Unauthorized", { status: 401 });

  const body = await req.json().catch(() => ({}));
  const supabase = db();
  const now = new Date().toISOString();

  const { data: existing } = await supabase
    .from("MemberAssessment")
    .select("*")
    .eq("memberId", member.id)
    .maybeSingle();

  // total steps = intro + N towers + review = TOWERS.length + 2
  const maxStep = TOWERS.length + 1;

  const lastStepIndex =
    typeof body.lastStepIndex === "number"
      ? Math.max(0, Math.min(maxStep, Math.floor(body.lastStepIndex)))
      : undefined;
  const status: "in_progress" | "completed" | undefined =
    body.complete === true ? "completed" : body.complete === false ? "in_progress" : undefined;
  const completedAt: string | null | undefined =
    body.complete === true ? now : body.complete === false ? null : undefined;
  const goals: string | undefined =
    typeof body.goals === "string" ? body.goals.trim().slice(0, 4000) : undefined;

  if (existing) {
    const { error } = await supabase
      .from("MemberAssessment")
      .update({
        ...(lastStepIndex !== undefined && { lastStepIndex }),
        ...(status !== undefined && { status }),
        ...(completedAt !== undefined && { completedAt }),
        ...(goals !== undefined && { goals }),
        updatedAt: now,
      })
      .eq("memberId", member.id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  } else {
    const { error } = await supabase
      .from("MemberAssessment")
      .insert({
        memberId: member.id,
        status: status ?? "in_progress",
        lastStepIndex: lastStepIndex ?? 0,
        startedAt: now,
        completedAt: completedAt ?? null,
        goals: goals ?? null,
        updatedAt: now,
      });
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
