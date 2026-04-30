import { NextRequest, NextResponse } from "next/server";
import { requireMinLevelApi } from "@/lib/dal";
import { MANAGER } from "@/lib/roles";
import {
  approveProposedModule,
  getStoryByReference,
} from "@/lib/dal/story-hierarchy";

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ ref: string }> },
) {
  const denied = await requireMinLevelApi(MANAGER);
  if (denied) return denied;

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
    );
    return NextResponse.json(result);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "approve failed";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
