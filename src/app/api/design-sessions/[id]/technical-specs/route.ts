import { db } from "@/lib/db";
import { NextRequest, NextResponse } from "next/server";
import { requireSessionAccessApi, requireSessionEditApi } from "@/lib/dal";
import { assertStepInSession } from "@/lib/design-session/guards";
import { z } from "zod";
import type { Json } from "@/lib/supabase/database.types";

const idText = z.object({ id: z.string(), text: z.string() }).passthrough();

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const denied = await requireSessionAccessApi(id);
  if (denied) return denied;

  const { data, error } = await db()
    .from("DesignSessionTechnicalSpecs")
    .select("*")
    .eq("sessionId", id)
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ technicalSpecs: data });
}

const upsertSchema = z.object({
  stack: z.string().optional(),
  performance: z.string().optional(),
  integrations: z.array(idText).optional(),
  rules: z.array(idText).optional(),
});

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const denied = await requireSessionEditApi(id);
  if (denied) return denied;

  const check = await assertStepInSession(id, "technical_specs");
  if (check instanceof NextResponse) return check;

  const parsed = upsertSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid body", issues: parsed.error.issues },
      { status: 400 },
    );
  }

  const { data, error } = await db()
    .from("DesignSessionTechnicalSpecs")
    .upsert(
      {
        sessionId: id,
        stack: parsed.data.stack ?? "",
        performance: parsed.data.performance ?? "",
        integrations: (parsed.data.integrations ?? []) as Json,
        rules: (parsed.data.rules ?? []) as Json,
        updatedAt: new Date().toISOString(),
      },
      { onConflict: "sessionId" },
    )
    .select()
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ technicalSpecs: data });
}
