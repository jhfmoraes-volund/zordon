import { db } from "@/lib/db";
import { NextRequest, NextResponse } from "next/server";
import { requireSessionEditApi } from "@/lib/dal";
import { z } from "zod";

const patchSchema = z.object({
  title: z.string().optional(),
  howItSolves: z.string().nullable().optional(),
  targetPersona: z.string().nullable().optional(),
  keyScreens: z.string().nullable().optional(),
  userFlows: z.string().nullable().optional(),
  painPointRef: z.string().nullable().optional(),
  technicalNotes: z.string().nullable().optional(),
  archived: z.boolean().optional(),
  moduleHint: z.string().nullable().optional(),
  orderIndex: z.number().int().nonnegative().optional(),
});

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; featureId: string }> },
) {
  const { id, featureId } = await params;
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
    .from("DesignSessionBrainstormFeature")
    .update({ ...parsed.data, updatedAt: new Date().toISOString() })
    .eq("id", featureId)
    .eq("sessionId", id)
    .select()
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ error: "Feature not found" }, { status: 404 });

  return NextResponse.json({ feature: data });
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; featureId: string }> },
) {
  const { id, featureId } = await params;
  const denied = await requireSessionEditApi(id);
  if (denied) return denied;

  const { error } = await db()
    .from("DesignSessionBrainstormFeature")
    .delete()
    .eq("id", featureId)
    .eq("sessionId", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}
