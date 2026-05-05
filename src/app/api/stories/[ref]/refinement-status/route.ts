import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireMinLevelApi } from "@/lib/dal";
import { MANAGER } from "@/lib/roles";
import { db } from "@/lib/db";

/**
 * PATCH /api/stories/[ref]/refinement-status
 *
 * Updates UserStory.refinementStatus. Used by the tree UI to revert a story
 * from 'committed' → 'refined' (reopen for editing) or to manually flip states
 * outside the agent flow.
 */

const Schema = z.object({
  status: z.enum(["draft", "refined", "committed"]),
});

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ ref: string }> },
) {
  const { ref } = await params;
  const denied = await requireMinLevelApi(MANAGER);
  if (denied) return denied;

  const body = await req.json().catch(() => ({}));
  const parsed = Schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "invalid body", details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const supabase = db();
  const { data, error } = await supabase
    .from("UserStory")
    .update({
      refinementStatus: parsed.data.status,
      updatedAt: new Date().toISOString(),
    })
    .eq("reference", ref)
    .select("id, reference, refinementStatus")
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ error: "Story not found" }, { status: 404 });
  return NextResponse.json(data);
}
