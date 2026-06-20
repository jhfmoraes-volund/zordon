import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireMinLevelApi } from "@/lib/dal";
import { MANAGER } from "@/lib/roles";

/**
 * GET /api/projects/[id]/members
 * Returns the squad of a project: UNION of the three sources that coexist in the
 * schema — Project.pmId + ProjectMember + (ProjectSquad → SquadMember). The PM
 * usually has no explicit ProjectMember row, and squad-only members (in the
 * linked squad but not in ProjectMember) would otherwise be dropped. Mirrors the
 * canonical loadProjectMembers (src/lib/agent/agents/vitoria/tools.ts).
 * Used by MeetingSheet to auto-select attendees for daily/super_planning.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const denied = await requireMinLevelApi(MANAGER);
  if (denied) return denied;

  const { id } = await params;

  const [pmRes, membersRes, psRes] = await Promise.all([
    db()
      .from("Project")
      .select("pm:Member!Project_pmId_fkey(id, name, role)")
      .eq("id", id)
      .maybeSingle(),
    db()
      .from("ProjectMember")
      .select("memberId, member:Member(id, name, role)")
      .eq("projectId", id),
    db().from("ProjectSquad").select("squadId").eq("projectId", id),
  ]);

  if (pmRes.error)
    return NextResponse.json({ error: pmRes.error.message }, { status: 500 });
  if (membersRes.error)
    return NextResponse.json(
      { error: membersRes.error.message },
      { status: 500 },
    );
  if (psRes.error)
    return NextResponse.json({ error: psRes.error.message }, { status: 500 });

  const byId = new Map<string, { id: string; name: string; role: string | null }>();

  const pm = Array.isArray(pmRes.data?.pm) ? pmRes.data?.pm[0] : pmRes.data?.pm;
  if (pm) byId.set(pm.id, { id: pm.id, name: pm.name, role: pm.role });

  for (const pmRow of membersRes.data ?? []) {
    const m = Array.isArray(pmRow.member) ? pmRow.member[0] : pmRow.member;
    if (m && !byId.has(m.id))
      byId.set(m.id, { id: m.id, name: m.name, role: m.role });
  }

  // 3) Squad linkada (ProjectSquad → SquadMember) — complementa, nunca substitui.
  const squadIds = (psRes.data ?? []).map((r) => r.squadId);
  if (squadIds.length > 0) {
    const smRes = await db()
      .from("SquadMember")
      .select("member:Member(id, name, role)")
      .in("squadId", squadIds);
    if (smRes.error)
      return NextResponse.json({ error: smRes.error.message }, { status: 500 });
    for (const smRow of smRes.data ?? []) {
      const m = Array.isArray(smRow.member) ? smRow.member[0] : smRow.member;
      if (m && !byId.has(m.id))
        byId.set(m.id, { id: m.id, name: m.name, role: m.role });
    }
  }

  return NextResponse.json(Array.from(byId.values()));
}
