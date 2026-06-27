import { db } from "@/lib/db";
import { NextRequest, NextResponse } from "next/server";
import { getActorMemberId } from "@/lib/dal";
import { requireCapabilityApi } from "@/lib/access/require-capability";
import { projectIdForSprint } from "@/lib/dal/sprint";
import { notifySprintLifecycle } from "@/lib/dal/notifications";

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const projectId = await projectIdForSprint(id);
  if (!projectId) return new NextResponse("Sprint não encontrada", { status: 404 });
  const denied = await requireCapabilityApi("sprint.write", { projectId });
  if (denied) return denied;

  const { data, error } = await db().rpc("activate_sprint", { p_sprint_id: id });

  if (error) {
    const status = error.code === "P0002" ? 404 : error.code === "P0001" ? 409 : 500;
    return NextResponse.json({ error: error.message }, { status });
  }

  const actorMemberId = await getActorMemberId();
  notifySprintLifecycle({
    sprintId: id,
    kind: "sprint_started",
    actorMemberId,
  }).catch((e) =>
    console.error("[notifications] sprint_started fanout failed", e),
  );

  return NextResponse.json(data);
}
