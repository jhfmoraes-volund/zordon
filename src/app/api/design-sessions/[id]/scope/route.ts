import { db } from "@/lib/db";
import { NextRequest, NextResponse } from "next/server";
import { requireSessionAccessApi, requireSessionEditApi } from "@/lib/dal";
import { assertStepInSession } from "@/lib/design-session/guards";
import { z } from "zod";
import type { Json } from "@/lib/supabase/database.types";

const idTextSchema = z.object({ id: z.string(), text: z.string() }).passthrough();
const bucketArray = z.array(idTextSchema);

// Accept both new names (inScope/outOfScope) and legacy (is/isNot).
const upsertSchema = z
  .object({
    inScope: bucketArray.optional(),
    outOfScope: bucketArray.optional(),
    does: bucketArray.optional(),
    doesNot: bucketArray.optional(),
    is: bucketArray.optional(),
    isNot: bucketArray.optional(),
  })
  .passthrough();

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const denied = await requireSessionAccessApi(id);
  if (denied) return denied;

  const { data, error } = await db()
    .from("DesignSessionScope")
    .select("*")
    .eq("sessionId", id)
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ scope: data });
}

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const denied = await requireSessionEditApi(id);
  if (denied) return denied;

  const check = await assertStepInSession(id, "scope_definition");
  if (check instanceof NextResponse) return check;

  const parsed = upsertSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid body", issues: parsed.error.issues },
      { status: 400 },
    );
  }

  const body = parsed.data;
  const inScope = (body.inScope ?? body.is ?? []) as Json;
  const outOfScope = (body.outOfScope ?? body.isNot ?? []) as Json;
  const does = (body.does ?? []) as Json;
  const doesNot = (body.doesNot ?? []) as Json;

  const { data, error } = await db()
    .from("DesignSessionScope")
    .upsert(
      {
        sessionId: id,
        inScope,
        outOfScope,
        does,
        doesNot,
        updatedAt: new Date().toISOString(),
      },
      { onConflict: "sessionId" },
    )
    .select()
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ scope: data });
}
