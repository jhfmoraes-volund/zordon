import { NextRequest, NextResponse } from "next/server";
import {
  canEditTasks,
  getActorMemberId,
  requireMinLevelApi,
} from "@/lib/dal";
import { BUILDER } from "@/lib/roles";
import { demotePrd, getPrdById } from "@/lib/dal/product-requirements";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

// Despromove um PRD aprovado de volta pra draft (limpa approvedAt/By), destravando
// a edição. Caminho dedicado porque o PATCH trata `approved` como imutável.
export async function POST(_req: NextRequest, ctx: RouteContext) {
  const denied = await requireMinLevelApi(BUILDER);
  if (denied) return denied;

  const { id } = await ctx.params;
  const current = await getPrdById(id);
  if (!current) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  if (!(await canEditTasks(current.projectId))) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const memberId = await getActorMemberId();

  try {
    const updated = await demotePrd(id, { actorMemberId: memberId });
    return NextResponse.json({ data: updated });
  } catch (error) {
    const message = String((error as Error)?.message ?? error);
    console.warn("demotePrd failure:", message);
    return NextResponse.json({ error: message }, { status: 409 });
  }
}
