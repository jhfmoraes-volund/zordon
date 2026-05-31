/**
 * POST /api/design-sessions/[id]/context/link
 * Linka um ContextSource existente à DesignSession.
 * Body: { contextSourceId: uuid, weight?: 'primary' | 'supporting' | 'background' }
 */
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireSessionEditApi, getActorMemberId } from "@/lib/dal";
import { z } from "zod";

const LinkContextSchema = z.object({
  contextSourceId: z.string().uuid(),
  weight: z.enum(["primary", "supporting", "background"]).optional(),
});

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: sessionId } = await params;

  const denied = await requireSessionEditApi(sessionId);
  if (denied) return denied;

  const memberId = await getActorMemberId();
  if (!memberId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Parse and validate body
  const body = await req.json().catch(() => null);
  const parsed = LinkContextSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid request body", details: parsed.error.format() },
      { status: 400 },
    );
  }

  const { contextSourceId, weight } = parsed.data;
  const supabase = db();

  // Check if already linked
  const { data: existing } = await supabase
    .from("EntityLink")
    .select("id")
    .eq("designSessionId", sessionId)
    .eq("contextSourceId", contextSourceId)
    .maybeSingle();

  if (existing) {
    return NextResponse.json(
      { error: "ContextSource already linked to this session" },
      { status: 409 },
    );
  }

  // Create link
  const { data: link, error } = await supabase
    .from("EntityLink")
    .insert({
      designSessionId: sessionId,
      contextSourceId: contextSourceId,
      linkedById: memberId,
      weight: weight || "primary",
    })
    .select()
    .single();

  if (error || !link) {
    return NextResponse.json(
      { error: error?.message || "Failed to create link" },
      { status: 500 },
    );
  }

  return NextResponse.json({ linkId: link.id });
}
