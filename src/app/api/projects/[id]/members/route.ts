import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireMinLevelApi } from "@/lib/dal";
import { MANAGER } from "@/lib/roles";

/**
 * GET /api/projects/[id]/members
 * Returns the squad of a project: UNION of Project.pmId + ProjectMember.
 * The PM usually has no explicit ProjectMember row, so we add it explicitly.
 * Used by MeetingSheet to auto-select attendees for daily/super_planning.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const denied = await requireMinLevelApi(MANAGER);
  if (denied) return denied;

  const { id } = await params;

  const [pmRes, membersRes] = await Promise.all([
    db()
      .from("Project")
      .select("pm:Member!Project_pmId_fkey(id, name, role)")
      .eq("id", id)
      .maybeSingle(),
    db()
      .from("ProjectMember")
      .select("memberId, member:Member(id, name, role)")
      .eq("projectId", id),
  ]);

  if (pmRes.error)
    return NextResponse.json({ error: pmRes.error.message }, { status: 500 });
  if (membersRes.error)
    return NextResponse.json(
      { error: membersRes.error.message },
      { status: 500 },
    );

  const byId = new Map<string, { id: string; name: string; role: string | null }>();

  const pm = Array.isArray(pmRes.data?.pm) ? pmRes.data?.pm[0] : pmRes.data?.pm;
  if (pm) byId.set(pm.id, { id: pm.id, name: pm.name, role: pm.role });

  for (const pmRow of membersRes.data ?? []) {
    const m = Array.isArray(pmRow.member) ? pmRow.member[0] : pmRow.member;
    if (m && !byId.has(m.id))
      byId.set(m.id, { id: m.id, name: m.name, role: m.role });
  }

  return NextResponse.json(Array.from(byId.values()));
}
