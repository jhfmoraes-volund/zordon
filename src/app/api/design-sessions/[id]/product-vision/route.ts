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
    .from("DesignSessionProductVision")
    .select("*")
    .eq("sessionId", id)
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ productVision: data });
}

const upsertSchema = z.object({
  problem: z.string().optional(),
  whoSuffers: z.string().optional(),
  consequences: z.string().optional(),
  successVision: z.string().optional(),
  impactMetrics: z.string().optional(),
});

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const denied = await requireSessionEditApi(id);
  if (denied) return denied;

  const check = await assertStepInSession(id, "product_vision");
  if (check instanceof NextResponse) return check;

  const parsed = upsertSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid body", issues: parsed.error.issues },
      { status: 400 },
    );
  }

  const { data, error } = await db()
    .from("DesignSessionProductVision")
    .upsert(
      {
        sessionId: id,
        problem: parsed.data.problem ?? "",
        whoSuffers: parsed.data.whoSuffers ?? "",
        consequences: parsed.data.consequences ?? "",
        successVision: parsed.data.successVision ?? "",
        impactMetrics: parsed.data.impactMetrics ?? "",
        updatedAt: new Date().toISOString(),
      },
      { onConflict: "sessionId" },
    )
    .select()
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ productVision: data });
}
