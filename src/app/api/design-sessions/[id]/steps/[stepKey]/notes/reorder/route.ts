import { db } from "@/lib/db";
import { NextRequest, NextResponse } from "next/server";
import { requireSessionEditApi } from "@/lib/dal";
import { assertStepInSession } from "@/lib/design-session/guards";
import { z } from "zod";

const bodySchema = z.object({
  noteIds: z.array(z.string().uuid()),
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

  const parsed = bodySchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid body", issues: parsed.error.issues },
      { status: 400 },
    );
  }

  const now = new Date().toISOString();
  const updates = parsed.data.noteIds.map((noteId, idx) =>
    db()
      .from("DesignSessionStepNote")
      .update({ orderIndex: idx, updatedAt: now })
      .eq("id", noteId)
      .eq("sessionId", id)
      .eq("stepKey", check.stepKey),
  );
  const results = await Promise.all(updates);
  const firstError = results.find((r) => r.error)?.error;
  if (firstError) {
    return NextResponse.json({ error: firstError.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
