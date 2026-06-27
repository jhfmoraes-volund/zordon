import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireCapabilityApi } from "@/lib/access/require-capability";
import { db } from "@/lib/db";

/**
 * PATCH /api/stories/[ref]/refinement-status
 *
 * Alterna UserStory.refinementStatus entre 'draft' (em construção, editável) e
 * 'committed' (travado como deliverable). Reabrir para 'draft' é permitido.
 */

const Schema = z.object({
  status: z.enum(["draft", "committed"]),
});

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ ref: string }> },
) {
  const { ref } = await params;

  // projectId p/ graduar não-managers (cap project-scoped); lookup inline.
  const { data: _row } = await db()
    .from("UserStory")
    .select("projectId")
    .eq("reference", ref)
    .maybeSingle();
  const projectId = _row?.projectId;
  if (!projectId) {
    return NextResponse.json({ error: "Story not found" }, { status: 404 });
  }

  const denied = await requireCapabilityApi("story.edit", { projectId });
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
