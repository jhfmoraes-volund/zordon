import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getCurrentMember } from "@/lib/dal";
import {
  TOWER_KEYS,
  SUBSKILL_STATES,
  computeScore,
  getTower,
  type SubskillMap,
} from "@/lib/memberSkills";

/**
 * PUT /api/profile/skills/[towerKey]
 * Upsert the current member's skill row for this tower.
 * Score is computed deterministically from the subskill marks.
 *
 * Body: {
 *   subskills: { [subskillKey]: "knows" | "ref" },
 *   cases?: string
 * }
 */
export async function PUT(
  req: NextRequest,
  ctx: { params: Promise<{ towerKey: string }> },
) {
  const member = await getCurrentMember();
  if (!member) return new NextResponse("Unauthorized", { status: 401 });

  const { towerKey } = await ctx.params;
  if (!(TOWER_KEYS as string[]).includes(towerKey)) {
    return NextResponse.json({ error: "Invalid tower" }, { status: 400 });
  }

  const body = await req.json().catch(() => ({}));

  const tower = getTower(towerKey)!;
  const validSubKeys = new Set(tower.subskills.map((s) => s.key));
  const incoming = (body.subskills ?? {}) as Record<string, string>;
  const subskills: SubskillMap = {};
  for (const [k, v] of Object.entries(incoming)) {
    if (!validSubKeys.has(k)) continue;
    if (v === "none") continue;
    if (!(SUBSKILL_STATES as readonly string[]).includes(v)) continue;
    subskills[k] = v as SubskillMap[string];
  }

  const cases =
    typeof body.cases === "string" ? body.cases.trim().slice(0, 4000) : null;

  const score = computeScore(subskills, tower.subskills.length);

  const supabase = db();
  const now = new Date().toISOString();

  const { data: existing } = await supabase
    .from("MemberSkill")
    .select("id")
    .eq("memberId", member.id)
    .eq("towerKey", towerKey)
    .maybeSingle();

  if (existing) {
    const { error } = await supabase
      .from("MemberSkill")
      .update({
        score,
        subskills,
        cases,
        updatedAt: now,
      })
      .eq("id", existing.id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  } else {
    const { error } = await supabase
      .from("MemberSkill")
      .insert({
        id: crypto.randomUUID(),
        memberId: member.id,
        towerKey,
        score,
        subskills,
        cases,
        createdAt: now,
        updatedAt: now,
      });
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, score });
}
