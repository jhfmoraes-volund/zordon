import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireMinLevelApi } from "@/lib/dal";
import { MANAGER } from "@/lib/roles";

/**
 * GET /api/projects/[id]/members
 * Returns the squad of a project (Member rows linked via ProjectMember).
 * Used by MeetingSheet to auto-select attendees for daily/super_planning.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const denied = await requireMinLevelApi(MANAGER);
  if (denied) return denied;

  const { id } = await params;
  const { data, error } = await db()
    .from("ProjectMember")
    .select("memberId, member:Member(id, name, role)")
    .eq("projectId", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const members = (data ?? [])
    .map((pm) => {
      const m = Array.isArray(pm.member) ? pm.member[0] : pm.member;
      return m ? { id: m.id, name: m.name, role: m.role } : null;
    })
    .filter((m): m is { id: string; name: string; role: string | null } => !!m);

  return NextResponse.json(members);
}
