/**
 * DELETE /api/pm-reviews/[id]/context/[linkId]
 * Remove o link entre ContextSource e PMReview.
 * Não apaga o ContextSource em si (pode estar linkado a outros lugares).
 */
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { canCreatePMReviewForProject } from "@/lib/pm-review/permission";

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; linkId: string }> },
) {
  const { id: pmReviewId, linkId } = await params;
  const supabase = db();

  // Check access
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
      { error: "Access denied. Only PMs (lead) or admins can edit." },
      { status: 403 },
    );
  }

  // Delete link (WHERE pinning both id and pmReviewId for safety)
  const { error } = await supabase
    .from("EntityLink")
    .delete()
    .eq("id", linkId)
    .eq("pmReviewId", pmReviewId);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
