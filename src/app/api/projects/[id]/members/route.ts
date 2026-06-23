import { NextRequest, NextResponse } from "next/server";
import { requireProjectViewApi } from "@/lib/dal";
import { getProjectTeam } from "@/lib/dal/project-team";

/**
 * GET /api/projects/[id]/members
 * Roster do projeto pela fonte canônica `finance.v_project_team` (alocados ∪
 * acesso-only; squad NÃO entra — D9). Substitui o UNION antigo de Project.pmId +
 * ProjectMember + squad linkada. Mesma fonte que loadProjectMembers (vitoria),
 * get_allocated_project_members (alpha) e os task sheets (assignee picker).
 *
 * Gate `requireProjectViewApi` (manager OU ProjectAccess) — espelha a RLS de
 * SELECT de ProjectMember (`is_manager() OR can_view_project`) que limitava as
 * leituras client-side antes; assim builders trabalhando num projeto que veem
 * mantêm o picker, sem expor roster de projetos alheios.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  const denied = await requireProjectViewApi(id);
  if (denied) return denied;

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
