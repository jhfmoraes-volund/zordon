import { db } from "@/lib/db";
import { NextRequest, NextResponse } from "next/server";
import { requireSessionEditApi } from "@/lib/dal";
import { z } from "zod";

const categoryEnum = z.enum(["business", "technical"]);
const severityEnum = z.enum(["high", "medium", "low"]);

const patchSchema = z.object({
  text: z.string().optional(),
  category: categoryEnum.optional(),
  severity: severityEnum.optional(),
  relatedFeature: z.string().nullable().optional(),
  mitigation: z.string().nullable().optional(),
  orderIndex: z.number().int().nonnegative().optional(),
});

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; riskId: string }> },
) {
  const { id, riskId } = await params;
  const denied = await requireSessionEditApi(id);
  if (denied) return denied;

  const parsed = patchSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid body", issues: parsed.error.issues },
      { status: 400 },
    );
  }

  const { data, error } = await db()
    .from("DesignSessionRisk")
    .update({ ...parsed.data, updatedAt: new Date().toISOString() })
    .eq("id", riskId)
    .eq("sessionId", id)
    .select()
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ error: "Risk not found" }, { status: 404 });

  return NextResponse.json({ risk: data });
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; riskId: string }> },
) {
  const { id, riskId } = await params;
  const denied = await requireSessionEditApi(id);
  if (denied) return denied;

  const { error } = await db()
    .from("DesignSessionRisk")
    .delete()
    .eq("id", riskId)
    .eq("sessionId", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}
