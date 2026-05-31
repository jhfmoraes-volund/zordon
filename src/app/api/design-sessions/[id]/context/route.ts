/**
 * GET /api/design-sessions/[id]/context
 * Lista todos os ContextSource linkados a uma DesignSession.
 */
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireSessionAccessApi } from "@/lib/dal";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: sessionId } = await params;

  const denied = await requireSessionAccessApi(sessionId);
  if (denied) return denied;

  const supabase = db();

  // Fetch all context links with ContextSource metadata
  const { data: links, error } = await supabase
    .from("EntityLink")
    .select(
      `
      id,
      "contextSourceId",
      "linkedById",
      "linkedAt",
      weight,
      ContextSource:ContextSource!EntityLink_contextSourceId_fkey (
        id,
        kind,
        title,
        externalUrl,
        capturedAt,
        summary,
        projectId
      )
    `,
    )
    .eq("designSessionId", sessionId)
    .not("contextSourceId", "is", null)
    .order("linkedAt", { ascending: false });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Transform to client-friendly shape (output keys mantidos: addedBy/addedAt).
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
