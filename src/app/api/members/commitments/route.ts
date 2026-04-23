import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireMinLevelApi } from "@/lib/dal";
import { MANAGER } from "@/lib/roles";

type ProjectRef = { id: string; name: string } | null;

/**
 * GET /api/members/commitments
 *
 * Retorna a bateria de cada membro (capacity / committed / remaining) com
 * breakdown das alocações por projeto. Usado pela UI de bateria (Members list,
 * Project detail) e por dashboards de planejamento.
 */
export async function GET() {
  const denied = await requireMinLevelApi(MANAGER);
  if (denied) return denied;

  const supabase = db();

  const [{ data: commitments, error: commitErr }, { data: allocations, error: allocErr }] =
    await Promise.all([
      supabase
        .from("member_commitment_overview")
        .select("*")
        .order("name"),
      supabase
        .from("ProjectMember")
        .select("memberId, fpAllocation, project:Project(id, name)"),
    ]);

  if (commitErr) return NextResponse.json({ error: commitErr.message }, { status: 500 });
  if (allocErr) return NextResponse.json({ error: allocErr.message }, { status: 500 });

  const byMember = new Map<string, Array<{ projectId: string; projectName: string; fpAllocation: number }>>();
  for (const row of allocations || []) {
    const proj = row.project as ProjectRef;
    if (!proj) continue;
    const bucket = byMember.get(row.memberId) || [];
    bucket.push({
      projectId: proj.id,
      projectName: proj.name,
      fpAllocation: Number(row.fpAllocation) || 0,
    });
    byMember.set(row.memberId, bucket);
  }

  const members = (commitments || []).map((m) => ({
    memberId: m.id,
    name: m.name,
    role: m.role,
    capacity: Number(m.capacity) || 0,
    committed: Number(m.committed) || 0,
    remaining: Number(m.remaining) || 0,
    projectCount: Number(m.project_count) || 0,
    projects: (byMember.get(m.id!) || []).sort((a, b) => b.fpAllocation - a.fpAllocation),
  }));

  return NextResponse.json({ members });
}
