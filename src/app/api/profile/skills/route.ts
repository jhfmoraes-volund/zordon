import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getCurrentMember } from "@/lib/dal";
import { computeScore, getTower, type SubskillMap } from "@/lib/memberSkills";

/**
 * GET /api/profile/skills
 * Returns assessment + skills for the current member.
 * Lazy-computes score for any legacy row that has subskills but score=null.
 */
export async function GET() {
  const member = await getCurrentMember();
  if (!member) return new NextResponse("Unauthorized", { status: 401 });

  const supabase = db();
  const [assessmentRes, skillsRes] = await Promise.all([
    supabase
      .from("MemberAssessment")
      .select("*")
      .eq("memberId", member.id)
      .maybeSingle(),
    supabase
      .from("MemberSkill")
      .select("id, towerKey, score, subskills, cases, updatedAt")
      .eq("memberId", member.id),
  ]);

  const skills = skillsRes.data ?? [];

  // Lazy-compute score on rows that have subskills but no score yet.
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
    assessment: assessmentRes.data ?? null,
    skills: skills.map(({ id: _id, ...rest }) => rest),
  });
}
