import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getUser } from "@/lib/dal";
import { updatePrdAssignment } from "@/lib/dal/planning-session";

const updateSchema = z.object({
  sprintStart: z.number().int().min(1).max(12).optional(),
  sprintCount: z.number().int().min(1).max(12).optional(),
  order: z.number().int().min(0).optional(),
  ownerOverride: z.string().uuid().nullable().optional(),
});

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; prdId: string }> },
) {
  const user = await getUser();
  if (!user) return new NextResponse("Unauthorized", { status: 401 });

  const { prdId } = await params;

  const body = await req.json().catch(() => null);
  const parsed = updateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.flatten() },
      { status: 400 },
    );
  }

  try {
    const prd = await updatePrdAssignment(prdId, parsed.data);
    return NextResponse.json({ prd });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "update failed";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
