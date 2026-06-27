/**
 * GET /api/pm-reviews/[id]/context
 * Lista todos os ContextSource linkados a um PMReview.
 */
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireCapabilityApi } from "@/lib/access/require-capability";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: pmReviewId } = await params;
  const supabase = db();

  // Check access (reuse PM Review permission helper)
  const { data: pm } = await supabase
    .from("PMReview")
    .select("projectId")
    .eq("id", pmReviewId)
    .maybeSingle();

  if (!pm) {
    return NextResponse.json({ error: "PM Review not found" }, { status: 404 });
  }

  // Leitura de PM Review = quem vê o projeto (pm_review.view), incl. PMs.
  const denied = await requireCapabilityApi("pm_review.view", {
    projectId: pm.projectId,
  });
  if (denied) return denied;

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
    .eq("pmReviewId", pmReviewId)
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
