import type { SupabaseClient } from "@supabase/supabase-js";
import {
  TOWERS,
  computeScore,
  derivePrimaryTowers,
  isFullstack,
  type MemberSkillRow,
  type SubskillMap,
  type TowerKey,
} from "@/lib/memberSkills";

export type MembersListItem = {
  id: string;
  name: string;
  email: string | null;
  role: string;
  position: string | null;
  specialty: string | null;
  githubUsername: string | null;
  isExternal: boolean;
  isGuest: boolean;
  fpCapacity: number;
  /** Soma de FP planejados (≠ backlog) nas sprints que rodam na semana atual. */
  fpPlannedWeek: number;
  /** Skill rows from the member self-assessment, one per tower. */
  skills: MemberSkillRow[];
  /** Highest-scoring tower (≥10). Null if no assessment. */
  primaryTower: TowerKey | null;
  /** Second-highest tower with score ≥50. Null otherwise. */
  secondaryTower: TowerKey | null;
  /** Frontend ≥70 AND Backend ≥70. */
  fullstack: boolean;
};

/**
 * Carrega Members + skills + carga semanal de FP (sprints da semana atual).
 * Funciona tanto com server client (`@/lib/supabase/server`) quanto com
 * client client (`@/lib/supabase/client`) — só lê dados. RLS aplica nos dois.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function loadMembersList(supabase: SupabaseClient<any, any, any>): Promise<MembersListItem[]> {
  const today = new Date().toISOString().slice(0, 10);

  const [membersRes, activeSprintsRes, skillsRes] = await Promise.all([
    supabase.from("Member").select("*").order("name"),
    supabase
      .from("Sprint")
      .select("id")
      .lte("startDate", today)
      .gte("endDate", today),
    supabase
      .from("MemberSkill")
      .select("memberId, towerKey, score, subskills, cases"),
  ]);

  const activeSprintIds = (activeSprintsRes.data ?? []).map((s) => s.id);

  type WeekLoadRow = { memberId: string; fp_planned: number };
  let weekRows: WeekLoadRow[] = [];
  if (activeSprintIds.length > 0) {
    const { data } = await supabase
      .from("sprint_member_capacity")
      .select("memberId, fp_planned")
      .in("sprintId", activeSprintIds);
    weekRows = (data ?? []) as unknown as WeekLoadRow[];
  }

  const weekLoadMap = new Map<string, number>();
  for (const r of weekRows) {
    weekLoadMap.set(r.memberId, (weekLoadMap.get(r.memberId) ?? 0) + (r.fp_planned ?? 0));
  }

  const skillsByMember = new Map<string, MemberSkillRow[]>();
  for (const row of (skillsRes.data ?? []) as Array<{
    memberId: string;
    towerKey: string;
    score: number | null;
    subskills: unknown;
    cases: string | null;
  }>) {
    const subs = (row.subskills ?? {}) as SubskillMap;
    const tower = TOWERS.find((t) => t.key === row.towerKey);
    let score = row.score;
    if ((score === null || score === undefined) && tower) {
      score = computeScore(subs, tower.subskills.length);
    }
    const list = skillsByMember.get(row.memberId) ?? [];
    list.push({ towerKey: row.towerKey, score, subskills: subs, cases: row.cases });
    skillsByMember.set(row.memberId, list);
  }

  return (membersRes.data ?? []).map((m: Record<string, unknown>) => {
    const id = m.id as string;
    const skills = skillsByMember.get(id) ?? [];
    const { primary, secondary } = derivePrimaryTowers(skills);
    return {
      id,
      name: m.name as string,
      email: (m.email as string) ?? null,
      role: m.role as string,
      position: ((m.position as string | null) ?? (m.role as string)) ?? null,
      specialty: (m.specialty as string) ?? null,
      githubUsername: (m.githubUsername as string) ?? null,
      isExternal: (m.isExternal as boolean) ?? false,
      isGuest: (m.isGuest as boolean) ?? false,
      fpCapacity: (m.fpCapacity as number) ?? 0,
      fpPlannedWeek: weekLoadMap.get(id) ?? 0,
      skills,
      primaryTower: primary,
      secondaryTower: secondary,
      fullstack: isFullstack(skills),
    };
  });
}
