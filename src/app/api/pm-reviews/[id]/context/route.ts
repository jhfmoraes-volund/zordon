/**
 * GET /api/pm-reviews/[id]/context
 * Lista todos os ContextSource linkados a um PMReview.
 */
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { canCreatePMReviewForProject } from "@/lib/pm-review/permission";

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

  const allowed = await canCreatePMReviewForProject(pm.projectId);
  if (!allowed) {
    return NextResponse.json(
      { error: "Access denied. Only PMs (lead) or admins can view." },
      { status: 403 },
    );
  }

  // Fetch all context links with ContextSource metadata
  const { data: links, error } = await supabase
    .from("PMReviewContextLink")
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
    .eq("pmreviewid", pmReviewId)
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
