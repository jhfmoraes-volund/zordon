import { NextRequest, NextResponse } from "next/server";
import { getActorMemberId } from "@/lib/dal";
import { requireCapabilityApi } from "@/lib/access/require-capability";
import { approvePrd, getPrdById } from "@/lib/dal/product-requirements";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

export async function POST(_req: NextRequest, ctx: RouteContext) {
  const { id } = await ctx.params;
  const current = await getPrdById(id);
  if (!current) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  // Reconcilia o gate legacy (requireMinLevelApi(BUILDER) + canEditTasks):
  // task.edit = manager bypass + ProjectAccess contributor/lead — mesmo nível.
  const denied = await requireCapabilityApi("task.edit", {
    projectId: current.projectId,
  });
  if (denied) return denied;

  const memberId = await getActorMemberId();
  if (!memberId) {
    return NextResponse.json(
      { error: "approver missing Member id" },
      { status: 422 },
    );
  }

  try {
    const updated = await approvePrd(id, { actorMemberId: memberId });
    return NextResponse.json({ data: updated });
  } catch (error) {
    // approvePrd throws on quality gates — surface as 422
    const message = String((error as Error)?.message ?? error);
    console.warn("approvePrd quality gate / failure:", message);
    return NextResponse.json({ error: message }, { status: 422 });
  }
}
