import { NextRequest, NextResponse } from "next/server";
import { getActorMemberId, requireMinLevelApi } from "@/lib/dal";
import { MANAGER } from "@/lib/roles";
import {
  getStoryByReference,
  validateStoryAc,
} from "@/lib/dal/story-hierarchy";

/**
 * AC validation = manager-only. PostgreSQL doesn't have column-level RLS
 * easily; the gate lives here at the API boundary.
 */
export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ ref: string }> },
) {
  const denied = await requireMinLevelApi(MANAGER);
  if (denied) return denied;

  const memberId = await getActorMemberId();
  if (!memberId) {
    return NextResponse.json(
      { error: "validator must be a Member" },
      { status: 400 },
    );
  }

  const { ref } = await params;
  const story = await getStoryByReference(ref);
  if (!story) return new NextResponse("Not found", { status: 404 });

  try {
    const updated = await validateStoryAc(story.id, memberId);
    return NextResponse.json({ story: updated });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "validate failed";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
