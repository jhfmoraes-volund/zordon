import { NextResponse } from "next/server";
import { requireMinLevelApi } from "@/lib/dal";
import { MANAGER } from "@/lib/roles";
import { loadMemberInsights } from "@/lib/members/member-capacity-load";

/**
 * GET /api/members/[id]/insights?weeks=12
 *
 * Throughput histórico: PFV *entregue* (Task.doneAt) por semana, nas últimas
 * N semanas, com breakdown por projeto. Difere de sprint_member_capacity.fp_done
 * (que é baseado em status atual, não em timestamp) — aqui a métrica é
 * doneAt-based, pra refletir entrega ao longo do tempo.
 */
export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const denied = await requireMinLevelApi(MANAGER);
  if (denied) return denied;

  const { id } = await params;
  const url = new URL(req.url);
  const weeks = Number(url.searchParams.get("weeks")) || 12;
  try {
    const payload = await loadMemberInsights(id, weeks);
    return NextResponse.json(payload);
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
