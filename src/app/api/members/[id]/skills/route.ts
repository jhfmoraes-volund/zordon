import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getUser } from "@/lib/dal";
import { computeScore, getTower, type SubskillMap } from "@/lib/memberSkills";

/**
 * GET /api/members/[id]/skills
 * Read-only access for any authenticated user (everyone sees everyone).
 * Lazy-computes scores on legacy rows.
 */
export async function GET(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const user = await getUser();
  if (!user) return new NextResponse("Unauthorized", { status: 401 });

  const { id } = await ctx.params;
  const supabase = db();

  const [memberRes, assessmentRes, skillsRes] = await Promise.all([
    supabase
      .from("Member")
      .select("id, name, role, position, specialty")
      .eq("id", id)
      .maybeSingle(),
    supabase
      .from("MemberAssessment")
      .select("status, completedAt, updatedAt, goals")
      .eq("memberId", id)
      .maybeSingle(),
    supabase
      .from("MemberSkill")
      .select("id, towerKey, score, subskills, cases, updatedAt")
      .eq("memberId", id),
  ]);

  if (!memberRes.data) {
    return NextResponse.json({ error: "Member not found" }, { status: 404 });
  }

  const skills = skillsRes.data ?? [];

  // Lazy-compute legacy rows with subskills but no score yet.
  const toBackfill = skills.filter((s) => {
    const subs = (s.subskills ?? {}) as SubskillMap;
    const hasMarks = Object.keys(subs).length > 0;
    return hasMarks && (s.score === null || s.score === undefined);
  });
  if (toBackfill.length > 0) {
    const now = new Date().toISOString();
    await Promise.all(
      toBackfill.map(async (s) => {
        const tower = getTower(s.towerKey);
        if (!tower) return;
        const score = computeScore(
          (s.subskills ?? {}) as SubskillMap,
          tower.subskills.length,
        );
        s.score = score;
        await supabase
          .from("MemberSkill")
          .update({ score, updatedAt: now })
          .eq("id", s.id);
      }),
    );
  }

  return NextResponse.json({
    member: memberRes.data,
    assessment: assessmentRes.data ?? null,
    skills: skills.map(({ id: _id, ...rest }) => rest),
  });
}
