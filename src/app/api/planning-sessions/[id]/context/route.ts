/**
 * GET /api/planning-sessions/[id]/context
 * Lista os ContextSource (insumos) linkados a um Release Planning.
 * Mesma forma do /api/design-sessions/[id]/context.
 */
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireProjectViewApi } from "@/lib/dal";
import { getSession } from "@/lib/dal/planning-session";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: sessionId } = await params;

  const session = await getSession(sessionId);
  if (!session) {
    return NextResponse.json({ error: "session not found" }, { status: 404 });
  }
  const denied = await requireProjectViewApi(session.projectId);
  if (denied) return denied;

  const { data: links, error } = await db()
    .from("EntityLink")
    .select(
      `
      id,
      "contextSourceId",
      "linkedById",
      "linkedAt",
      weight,
      ContextSource:ContextSource!EntityLink_contextSourceId_fkey (
        id, kind, title, externalUrl, capturedAt, summary, projectId
      )
    `,
    )
    .eq("planningSessionId", sessionId)
    .not("contextSourceId", "is", null)
    .order("linkedAt", { ascending: false });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const contextLinks = (links || []).map((link) => ({
    linkId: link.id,
    sourceId: link.contextSourceId,
    addedBy: link.linkedById,
    addedAt: link.linkedAt,
    weight: link.weight,
    source: link.ContextSource,
  }));

  return NextResponse.json({ contextLinks });
}
