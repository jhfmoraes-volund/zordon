/**
 * POST /api/pm-reviews/[id]/context/link
 * Linka um ContextSource existente ao PMReview.
 * Body: { contextSourceId: uuid, weight?: 'primary' | 'supporting' | 'background' }
 */
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getActorMemberId } from "@/lib/dal";
import { canCreatePMReviewForProject } from "@/lib/pm-review/permission";
import { z } from "zod";

const LinkContextSchema = z.object({
  contextSourceId: z.string().uuid(),
  weight: z.enum(["primary", "supporting", "background"]).optional(),
});

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: pmReviewId } = await params;
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

  // Check if already linked
  const { data: existing } = await supabase
    .from("EntityLink")
    .select("id")
    .eq("pmReviewId", pmReviewId)
    .eq("contextSourceId", contextSourceId)
    .maybeSingle();

  if (existing) {
    return NextResponse.json(
      { error: "ContextSource already linked to this PM Review" },
      { status: 409 },
    );
  }

  // Create link
  const { data: link, error } = await supabase
    .from("EntityLink")
    .insert({
      pmReviewId: pmReviewId,
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
