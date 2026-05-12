import { db } from "@/lib/db";
import { NextRequest, NextResponse } from "next/server";
import { requireSessionAccessApi, requireSessionEditApi } from "@/lib/dal";
import { assertStepInSession } from "@/lib/design-session/guards";
import { z } from "zod";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; stepKey: string }> },
) {
  const { id, stepKey } = await params;
  const denied = await requireSessionAccessApi(id);
  if (denied) return denied;

  const check = await assertStepInSession(id, stepKey);
  if (check instanceof NextResponse) return check;

  const { data, error } = await db()
    .from("DesignSessionStepNote")
    .select("*")
    .eq("sessionId", id)
    .eq("stepKey", check.stepKey)
    .order("orderIndex", { ascending: true });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ notes: data ?? [] });
}

const createSchema = z.object({
  text: z.string().optional(),
  orderIndex: z.number().int().nonnegative().optional(),
});

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; stepKey: string }> },
) {
  const { id, stepKey } = await params;
  const denied = await requireSessionEditApi(id);
  if (denied) return denied;

  const check = await assertStepInSession(id, stepKey);
  if (check instanceof NextResponse) return check;

  const parsed = createSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid body", issues: parsed.error.issues },
      { status: 400 },
    );
  }

  let orderIndex = parsed.data.orderIndex;
  if (orderIndex === undefined) {
    const { data: last } = await db()
      .from("DesignSessionStepNote")
      .select("orderIndex")
      .eq("sessionId", id)
      .eq("stepKey", check.stepKey)
      .order("orderIndex", { ascending: false })
      .limit(1)
      .maybeSingle();
    orderIndex = (last?.orderIndex ?? -1) + 1;
  }

  const { data, error } = await db()
    .from("DesignSessionStepNote")
    .insert({
      sessionId: id,
      stepKey: check.stepKey,
      text: parsed.data.text ?? "",
      orderIndex,
    })
    .select()
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ note: data });
}
