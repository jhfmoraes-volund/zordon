import { db } from "@/lib/db";
import { NextRequest, NextResponse } from "next/server";
import { requireSessionAccessApi, requireSessionEditApi } from "@/lib/dal";
import { assertStepInSession } from "@/lib/design-session/guards";
import { z } from "zod";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const denied = await requireSessionAccessApi(id);
  if (denied) return denied;

  const { data, error } = await db()
    .from("DesignSessionHypothesis")
    .select("*")
    .eq("sessionId", id)
    .order("orderIndex", { ascending: true });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ hypotheses: data ?? [] });
}

const createSchema = z.object({
  hypothesis: z.string().optional(),
  indicator: z.string().optional(),
  target: z.string().optional(),
  expectedResult: z.string().optional(),
  evidence: z.string().optional(),
  orderIndex: z.number().int().nonnegative().optional(),
});

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const denied = await requireSessionEditApi(id);
  if (denied) return denied;

  const check = await assertStepInSession(id, "hypotheses");
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
      .from("DesignSessionHypothesis")
      .select("orderIndex")
      .eq("sessionId", id)
      .order("orderIndex", { ascending: false })
      .limit(1)
      .maybeSingle();
    orderIndex = (last?.orderIndex ?? -1) + 1;
  }

  const { data, error } = await db()
    .from("DesignSessionHypothesis")
    .insert({
      sessionId: id,
      hypothesis: parsed.data.hypothesis ?? "",
      indicator: parsed.data.indicator ?? "",
      target: parsed.data.target ?? "",
      expectedResult: parsed.data.expectedResult ?? "",
      evidence: parsed.data.evidence ?? null,
      orderIndex,
    })
    .select()
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ hypothesis: data });
}
