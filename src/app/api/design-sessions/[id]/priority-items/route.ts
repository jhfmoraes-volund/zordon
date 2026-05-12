import { db } from "@/lib/db";
import { NextRequest, NextResponse } from "next/server";
import { requireSessionAccessApi, requireSessionEditApi } from "@/lib/dal";
import { assertStepInSession } from "@/lib/design-session/guards";
import { z } from "zod";

const bucketEnum = z.enum(["mvp", "next", "out"]);

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const denied = await requireSessionAccessApi(id);
  if (denied) return denied;

  const { data, error } = await db()
    .from("DesignSessionPriorityItem")
    .select("*")
    .eq("sessionId", id)
    .order("orderIndex", { ascending: true });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ items: data ?? [] });
}

const createSchema = z.object({
  title: z.string().optional(),
  howItSolves: z.string().optional(),
  targetPersona: z.string().optional(),
  bucket: bucketEnum.optional(),
  keyScreens: z.string().nullable().optional(),
  userFlows: z.string().nullable().optional(),
  painPointRef: z.string().nullable().optional(),
  technicalNotes: z.string().nullable().optional(),
  orderIndex: z.number().int().nonnegative().optional(),
});

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const denied = await requireSessionEditApi(id);
  if (denied) return denied;

  const check = await assertStepInSession(id, "prioritization");
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
      .from("DesignSessionPriorityItem")
      .select("orderIndex")
      .eq("sessionId", id)
      .order("orderIndex", { ascending: false })
      .limit(1)
      .maybeSingle();
    orderIndex = (last?.orderIndex ?? -1) + 1;
  }

  const { data, error } = await db()
    .from("DesignSessionPriorityItem")
    .insert({
      sessionId: id,
      title: parsed.data.title ?? "",
      howItSolves: parsed.data.howItSolves ?? "",
      targetPersona: parsed.data.targetPersona ?? "",
      bucket: parsed.data.bucket ?? "next",
      keyScreens: parsed.data.keyScreens ?? null,
      userFlows: parsed.data.userFlows ?? null,
      painPointRef: parsed.data.painPointRef ?? null,
      technicalNotes: parsed.data.technicalNotes ?? null,
      orderIndex,
    })
    .select()
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ item: data });
}
