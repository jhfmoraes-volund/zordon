import { db } from "@/lib/db";
import { NextRequest, NextResponse } from "next/server";
import { requireSessionAccessApi, requireSessionEditApi } from "@/lib/dal";
import { assertStepInSession } from "@/lib/design-session/guards";
import { z } from "zod";

const categoryEnum = z.enum(["business", "technical"]);
const severityEnum = z.enum(["high", "medium", "low"]);

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const denied = await requireSessionAccessApi(id);
  if (denied) return denied;

  const { data, error } = await db()
    .from("DesignSessionGap")
    .select("*")
    .eq("sessionId", id)
    .order("orderIndex", { ascending: true });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ gaps: data ?? [] });
}

const createSchema = z.object({
  text: z.string().optional(),
  category: categoryEnum.nullable().optional(),
  severity: severityEnum.nullable().optional(),
  relatedFeature: z.string().nullable().optional(),
  mitigation: z.string().nullable().optional(),
  orderIndex: z.number().int().nonnegative().optional(),
});

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const denied = await requireSessionEditApi(id);
  if (denied) return denied;

  const check = await assertStepInSession(id, "risks_gaps");
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
      .from("DesignSessionGap")
      .select("orderIndex")
      .eq("sessionId", id)
      .order("orderIndex", { ascending: false })
      .limit(1)
      .maybeSingle();
    orderIndex = (last?.orderIndex ?? -1) + 1;
  }

  const { data, error } = await db()
    .from("DesignSessionGap")
    .insert({
      sessionId: id,
      text: parsed.data.text ?? "",
      category: parsed.data.category ?? null,
      severity: parsed.data.severity ?? null,
      relatedFeature: parsed.data.relatedFeature ?? null,
      mitigation: parsed.data.mitigation ?? null,
      orderIndex,
    })
    .select()
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ gap: data });
}
