import { db } from "@/lib/db";
import { NextRequest, NextResponse } from "next/server";
import { getUser, getMemberId, getActorMemberId } from "@/lib/dal";
import { notifySprintLifecycle } from "@/lib/dal/notifications";

type Body = {
  goodPoints?: string | null;
  badPoints?: string | null;
  ideas?: string | null;
};

function normalize(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const trimmed = v.trim();
  return trimmed === "" ? null : trimmed;
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getUser();
  if (!user) return new NextResponse("Unauthorized", { status: 401 });

  const { id } = await params;
  const body = (await req.json().catch(() => ({}))) as Body;

  const memberId = await getMemberId();

  const retroPayload = {
    sprintId: id,
    goodPoints: normalize(body.goodPoints),
    badPoints: normalize(body.badPoints),
    ideas: normalize(body.ideas),
    completedBy: memberId,
    completedAt: new Date().toISOString(),
  };

  const hasAnyRetroContent =
    retroPayload.goodPoints !== null ||
    retroPayload.badPoints !== null ||
    retroPayload.ideas !== null;

  const supabase = db();

  if (hasAnyRetroContent) {
    const { error: retroError } = await supabase
      .from("SprintRetrospective")
      .upsert(retroPayload, { onConflict: "sprintId" });
    if (retroError) {
      return NextResponse.json({ error: retroError.message }, { status: 500 });
    }
  }

  const { data: sprint, error: sprintError } = await supabase
    .from("Sprint")
    .update({ status: "completed" })
    .eq("id", id)
    .select()
    .single();
  if (sprintError) {
    return NextResponse.json({ error: sprintError.message }, { status: 500 });
  }

  const actorMemberId = await getActorMemberId();
  notifySprintLifecycle({
    sprintId: id,
    kind: "sprint_ended",
    actorMemberId,
  }).catch((e) =>
    console.error("[notifications] sprint_ended fanout failed", e),
  );

  return NextResponse.json({ sprint, retroSaved: hasAnyRetroContent });
}
