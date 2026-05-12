import { db } from "@/lib/db";
import { NextRequest, NextResponse } from "next/server";
import { requireSessionEditApi } from "@/lib/dal";
import { z } from "zod";

const bodySchema = z.object({
  hypothesisIds: z.array(z.string().uuid()),
});

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const denied = await requireSessionEditApi(id);
  if (denied) return denied;

  const parsed = bodySchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid body", issues: parsed.error.issues },
      { status: 400 },
    );
  }

  const now = new Date().toISOString();
  const results = await Promise.all(
    parsed.data.hypothesisIds.map((hypId, idx) =>
      db()
        .from("DesignSessionHypothesis")
        .update({ orderIndex: idx, updatedAt: now })
        .eq("id", hypId)
        .eq("sessionId", id),
    ),
  );
  const firstError = results.find((r) => r.error)?.error;
  if (firstError) {
    return NextResponse.json({ error: firstError.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
