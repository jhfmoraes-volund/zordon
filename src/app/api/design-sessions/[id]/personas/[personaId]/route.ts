import { db } from "@/lib/db";
import { NextRequest, NextResponse } from "next/server";
import { requireSessionEditApi } from "@/lib/dal";
import { z } from "zod";
import type { Json } from "@/lib/supabase/database.types";

const journeyStep = z.object({
  id: z.string(),
  description: z.string().optional(),
  painOrGain: z.string().optional(),
}).passthrough();

const patchSchema = z.object({
  name: z.string().optional(),
  role: z.string().optional(),
  context: z.string().optional(),
  asIsSteps: z.array(journeyStep).optional(),
  toBeSteps: z.array(journeyStep).optional(),
  orderIndex: z.number().int().nonnegative().optional(),
});

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; personaId: string }> },
) {
  const { id, personaId } = await params;
  const denied = await requireSessionEditApi(id);
  if (denied) return denied;

  const parsed = patchSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid body", issues: parsed.error.issues },
      { status: 400 },
    );
  }

  const patch: {
    name?: string;
    role?: string;
    context?: string;
    asIsSteps?: Json;
    toBeSteps?: Json;
    orderIndex?: number;
    updatedAt: string;
  } = { updatedAt: new Date().toISOString() };
  if (parsed.data.name !== undefined) patch.name = parsed.data.name;
  if (parsed.data.role !== undefined) patch.role = parsed.data.role;
  if (parsed.data.context !== undefined) patch.context = parsed.data.context;
  if (parsed.data.asIsSteps !== undefined) patch.asIsSteps = parsed.data.asIsSteps as Json;
  if (parsed.data.toBeSteps !== undefined) patch.toBeSteps = parsed.data.toBeSteps as Json;
  if (parsed.data.orderIndex !== undefined) patch.orderIndex = parsed.data.orderIndex;

  const { data, error } = await db()
    .from("DesignSessionPersona")
    .update(patch)
    .eq("id", personaId)
    .eq("sessionId", id)
    .select()
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ error: "Persona not found" }, { status: 404 });

  return NextResponse.json({ persona: data });
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; personaId: string }> },
) {
  const { id, personaId } = await params;
  const denied = await requireSessionEditApi(id);
  if (denied) return denied;

  const { error } = await db()
    .from("DesignSessionPersona")
    .delete()
    .eq("id", personaId)
    .eq("sessionId", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}
