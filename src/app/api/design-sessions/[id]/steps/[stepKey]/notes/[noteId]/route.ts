import { db } from "@/lib/db";
import { NextRequest, NextResponse } from "next/server";
import { requireSessionEditApi } from "@/lib/dal";
import { assertStepInSession } from "@/lib/design-session/guards";
import { z } from "zod";

const patchSchema = z.object({
  text: z.string().optional(),
  orderIndex: z.number().int().nonnegative().optional(),
});

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; stepKey: string; noteId: string }> },
) {
  const { id, stepKey, noteId } = await params;
  const denied = await requireSessionEditApi(id);
  if (denied) return denied;

  const check = await assertStepInSession(id, stepKey);
  if (check instanceof NextResponse) return check;

  const parsed = patchSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid body", issues: parsed.error.issues },
      { status: 400 },
    );
  }

  const patch: { text?: string; orderIndex?: number; updatedAt: string } = {
    updatedAt: new Date().toISOString(),
  };
  if (parsed.data.text !== undefined) patch.text = parsed.data.text;
  if (parsed.data.orderIndex !== undefined) patch.orderIndex = parsed.data.orderIndex;

  const { data, error } = await db()
    .from("DesignSessionStepNote")
    .update(patch)
    .eq("id", noteId)
    .eq("sessionId", id)
    .eq("stepKey", check.stepKey)
    .select()
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ error: "Note not found" }, { status: 404 });

  return NextResponse.json({ note: data });
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; stepKey: string; noteId: string }> },
) {
  const { id, stepKey, noteId } = await params;
  const denied = await requireSessionEditApi(id);
  if (denied) return denied;

  const check = await assertStepInSession(id, stepKey);
  if (check instanceof NextResponse) return check;

  const { error } = await db()
    .from("DesignSessionStepNote")
    .delete()
    .eq("id", noteId)
    .eq("sessionId", id)
    .eq("stepKey", check.stepKey);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}
