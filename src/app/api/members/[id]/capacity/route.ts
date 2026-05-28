import { NextResponse } from "next/server";
import { requireMinLevelApi } from "@/lib/dal";
import { MANAGER } from "@/lib/roles";
import { loadMemberCapacity } from "@/lib/members/member-capacity-load";

/**
 * GET /api/members/[id]/capacity
 *
 * Retorna tudo que a página /members/[id] precisa:
 *   - member (identidade + bateria total Member.fpCapacity)
 *   - commitment (bateria agregada: capacity / committed / remaining)
 *   - projects (ProjectMember.fpAllocation por projeto)
 *   - sprints (todos os sprints dos projetos do membro, com allocation efetiva,
 *              fp_planned/fp_done/fp_open, flag de override)
 *
 * Reusado pelo page server-component em `members/[id]/page.tsx` via
 * `loadMemberCapacity` direto (sem HTTP).
 */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const denied = await requireMinLevelApi(MANAGER);
  if (denied) return denied;

  const { id } = await params;
  try {
    const payload = await loadMemberCapacity(id);
    if (!payload) return NextResponse.json({ error: "Member not found" }, { status: 404 });
    return NextResponse.json(payload);
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
