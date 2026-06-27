import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireCapabilityApi } from "@/lib/access/require-capability";
import { update } from "@/lib/dal/opportunities";
import { db } from "@/lib/db";

// Validation schema for PATCH body (all fields optional)
const patchSchema = z.object({
  title: z.string().min(1, "Title cannot be empty").optional(),
  description: z.string().nullable().optional(),
  impact: z.number().int().min(1).max(5).optional(),
  effort: z.number().int().min(1).max(5).optional(),
  status: z
    .enum(["discovery", "evaluating", "approved", "in_project", "rejected"])
    .optional(),
  priorityRank: z.number().nullable().optional(),
});

/**
 * PATCH /api/opportunities/[id]
 * Updates an existing opportunity with partial fields.
 * Validates input via Zod partial schema. RLS enforced via update DAL.
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const denied = await requireCapabilityApi("opportunity.write");
  if (denied) return denied;

  const { id } = await params;

  const body = await req.json().catch(() => null);
  const parsed = patchSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.flatten() },
      { status: 400 },
    );
  }

  try {
    const opportunity = await update(id, parsed.data);
    return NextResponse.json({ opportunity }, { status: 200 });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "update failed";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

/**
 * DELETE /api/opportunities/[id]
 * Hard deletes an opportunity.
 * Note: UI typically uses softReject (PATCH status to 'rejected').
 * This hard delete is available for admin cleanup.
 */
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const denied = await requireCapabilityApi("opportunity.write");
  if (denied) return denied;

  const { id } = await params;

  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Table not in database.types.ts yet (OPP-005)
    const { error } = await db().from("Opportunity" as any).delete().eq("id", id);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return new Response(null, { status: 204 });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "delete failed";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
