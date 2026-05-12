import { db } from "@/lib/db";
import { NextRequest, NextResponse } from "next/server";
import { requireSessionEditApi } from "@/lib/dal";
import { z } from "zod";

const patchSchema = z.object({
  hypothesis: z.string().optional(),
  indicator: z.string().optional(),
  target: z.string().optional(),
  expectedResult: z.string().optional(),
  evidence: z.string().nullable().optional(),
  orderIndex: z.number().int().nonnegative().optional(),
});

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; hypothesisId: string }> },
) {
  const { id, hypothesisId } = await params;
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
    .from("DesignSessionHypothesis")
    .update({ ...parsed.data, updatedAt: new Date().toISOString() })
    .eq("id", hypothesisId)
    .eq("sessionId", id)
    .select()
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ error: "Hypothesis not found" }, { status: 404 });

  return NextResponse.json({ hypothesis: data });
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; hypothesisId: string }> },
) {
  const { id, hypothesisId } = await params;
  const denied = await requireSessionEditApi(id);
  if (denied) return denied;

  const { error } = await db()
    .from("DesignSessionHypothesis")
    .delete()
    .eq("id", hypothesisId)
    .eq("sessionId", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}
