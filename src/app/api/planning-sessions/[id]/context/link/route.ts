/**
 * POST /api/planning-sessions/[id]/context/link
 * Linka um ContextSource existente ao Release Planning.
 * Body: { contextSourceId: uuid }
 */
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requirePlanningOperateApi, getActorMemberId } from "@/lib/dal";
import { getSession, linkContextSource } from "@/lib/dal/planning-session";
import { db } from "@/lib/db";

const LinkSchema = z.object({
  contextSourceId: z.string().uuid(),
});

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: sessionId } = await params;

  const session = await getSession(sessionId);
  if (!session) {
    return NextResponse.json({ error: "session not found" }, { status: 404 });
  }
  const denied = await requirePlanningOperateApi(session.projectId);
  if (denied) return denied;

  const memberId = await getActorMemberId();
  if (!memberId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json().catch(() => null);
  const parsed = LinkSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  // Idempotência — já linkado?
  const { data: existing } = await db()
    .from("EntityLink")
    .select("id")
    .eq("planningSessionId", sessionId)
    .eq("contextSourceId", parsed.data.contextSourceId)
    .maybeSingle();
  if (existing) {
    return NextResponse.json({ linkId: existing.id });
  }

  try {
    const link = await linkContextSource(
      sessionId,
      parsed.data.contextSourceId,
      memberId,
    );
    return NextResponse.json({ linkId: link.id });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "link failed";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
