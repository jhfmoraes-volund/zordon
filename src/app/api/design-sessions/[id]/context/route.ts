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
    .from("DesignSessionContextLink")
    .select(
      `
      id,
      contextsourceid,
      addedby,
      addedat,
      weight,
      ContextSource:contextsourceid (
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
    .eq("designsessionid", sessionId)
    .order("addedat", { ascending: false });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Transform to client-friendly shape
  const contextLinks = (links || []).map((link) => ({
    linkId: link.id,
    sourceId: link.contextsourceid,
    addedBy: link.addedby,
    addedAt: link.addedat,
    weight: link.weight,
    source: link.ContextSource,
  }));

  return NextResponse.json({ contextLinks });
}
