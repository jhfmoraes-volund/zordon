import { NextRequest, NextResponse } from "next/server";
import { requireMinLevelApi } from "@/lib/dal";
import { getProjectTeam } from "@/lib/dal/project-team";
import { MANAGER } from "@/lib/roles";

/**
 * GET /api/projects/[id]/members
 * Roster do projeto pela fonte canônica `finance.v_project_team` (alocados ∪
 * acesso-only; squad NÃO entra — D9). Substitui o UNION antigo de Project.pmId +
 * ProjectMember + squad linkada. Mesma fonte que loadProjectMembers
 * (vitoria) e get_allocated_project_members (alpha). Usado pelo MeetingSheet pra
 * auto-selecionar attendees de daily/super_planning.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const denied = await requireMinLevelApi(MANAGER);
  if (denied) return denied;

  const { id } = await params;

  try {
    const team = await getProjectTeam(id);
    return NextResponse.json(
      team.map((m) => ({ id: m.memberId, name: m.name, role: m.role })),
    );
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "unknown error" },
      { status: 500 },
    );
  }
}
