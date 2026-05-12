import { db } from "@/lib/db";
import { NextRequest, NextResponse } from "next/server";
import { requireSessionEditApi } from "@/lib/dal";
import { assertStepInSession } from "@/lib/design-session/guards";

/**
 * Seeds DesignSessionPriorityItem from non-archived BrainstormFeatures for the
 * given session. Idempotent: skips items whose source feature title is already
 * present in the priority list (title is the only stable link, since
 * BrainstormFeature.id is text and PriorityItem.id is uuid).
 */
export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const denied = await requireSessionEditApi(id);
  if (denied) return denied;

  const check = await assertStepInSession(id, "prioritization");
  if (check instanceof NextResponse) return check;

  const [{ data: features }, { data: existing }] = await Promise.all([
    db()
      .from("DesignSessionBrainstormFeature")
      .select("title, howItSolves, targetPersona, keyScreens, userFlows, painPointRef, technicalNotes")
      .eq("sessionId", id)
      .eq("archived", false)
      .order("orderIndex", { ascending: true }),
    db()
      .from("DesignSessionPriorityItem")
      .select("title")
      .eq("sessionId", id),
  ]);

  const existingTitles = new Set((existing ?? []).map((r) => r.title));
  const toSeed = (features ?? []).filter((f) => !existingTitles.has(f.title));

  if (toSeed.length === 0) {
    return NextResponse.json({ seeded: 0, items: [] });
  }

  const { data: lastItem } = await db()
    .from("DesignSessionPriorityItem")
    .select("orderIndex")
    .eq("sessionId", id)
    .order("orderIndex", { ascending: false })
    .limit(1)
    .maybeSingle();
  let nextOrder = (lastItem?.orderIndex ?? -1) + 1;

  const rows = toSeed.map((f) => ({
    sessionId: id,
    title: f.title,
    howItSolves: f.howItSolves ?? "",
    targetPersona: f.targetPersona ?? "",
    bucket: "mvp" as const,
    keyScreens: f.keyScreens ?? null,
    userFlows: f.userFlows ?? null,
    painPointRef: f.painPointRef ?? null,
    technicalNotes: f.technicalNotes ?? null,
    orderIndex: nextOrder++,
  }));

  const { data, error } = await db()
    .from("DesignSessionPriorityItem")
    .insert(rows)
    .select();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ seeded: data?.length ?? 0, items: data ?? [] });
}
