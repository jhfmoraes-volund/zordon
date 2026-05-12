import { db } from "@/lib/db";
import { NextRequest, NextResponse } from "next/server";
import { requireSessionAccessApi, requireSessionEditApi } from "@/lib/dal";
import { assertStepInSession } from "@/lib/design-session/guards";
import { z } from "zod";
import type { Json } from "@/lib/supabase/database.types";

const journeyStep = z.object({
  id: z.string(),
  description: z.string().optional(),
  painOrGain: z.string().optional(),
}).passthrough();

const createSchema = z.object({
  name: z.string().optional(),
  role: z.string().optional(),
  context: z.string().optional(),
  asIsSteps: z.array(journeyStep).optional(),
  toBeSteps: z.array(journeyStep).optional(),
  orderIndex: z.number().int().nonnegative().optional(),
});

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const denied = await requireSessionAccessApi(id);
  if (denied) return denied;

  const { data, error } = await db()
    .from("DesignSessionPersona")
    .select("*")
    .eq("sessionId", id)
    .order("orderIndex", { ascending: true });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ personas: data ?? [] });
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const denied = await requireSessionEditApi(id);
  if (denied) return denied;

  const check = await assertStepInSession(id, "personas_journeys");
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
      .from("DesignSessionPersona")
      .select("orderIndex")
      .eq("sessionId", id)
      .order("orderIndex", { ascending: false })
      .limit(1)
      .maybeSingle();
    orderIndex = (last?.orderIndex ?? -1) + 1;
  }

  const { data, error } = await db()
    .from("DesignSessionPersona")
    .insert({
      sessionId: id,
      name: parsed.data.name ?? "",
      role: parsed.data.role ?? "",
      context: parsed.data.context ?? "",
      asIsSteps: (parsed.data.asIsSteps ?? []) as Json,
      toBeSteps: (parsed.data.toBeSteps ?? []) as Json,
      orderIndex,
    })
    .select()
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ persona: data });
}
