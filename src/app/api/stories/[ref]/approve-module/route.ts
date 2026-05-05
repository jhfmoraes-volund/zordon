import { NextRequest, NextResponse } from "next/server";
import { requireMinLevelApi, getCurrentMember } from "@/lib/dal";
import { MANAGER } from "@/lib/roles";
import {
  approveProposedModule,
  getStoryByReference,
  promoteTasksForModule,
} from "@/lib/dal/story-hierarchy";

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ ref: string }> },
) {
  const denied = await requireMinLevelApi(MANAGER);
  if (denied) return denied;
  const member = await getCurrentMember();

  const { ref } = await params;
  const story = await getStoryByReference(ref);
  if (!story) return new NextResponse("Not found", { status: 404 });
  if (!story.proposedModuleName) {
    return NextResponse.json(
      { error: "story has no proposedModuleName" },
      { status: 400 },
    );
  }

  try {
    const result = await approveProposedModule(
      story.id,
      story.projectId,
      story.proposedModuleName,
      member?.id ?? null,
    );
    // Promote draft tasks under the (now-approved) module. Idempotent —
    // subsequent calls for sibling stories see no remaining drafts.
    const { promoted, totalFp } = await promoteTasksForModule(result.module.id);
    return NextResponse.json({ ...result, promoted, totalFp });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "approve failed";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
