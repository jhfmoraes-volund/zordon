import { db } from "@/lib/db";
import { NextRequest, NextResponse } from "next/server";
import { getActorMemberId, getUser } from "@/lib/dal";
import { notifySprintLifecycle } from "@/lib/dal/notifications";

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getUser();
  if (!user) return new NextResponse("Unauthorized", { status: 401 });

  const { id } = await params;
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
