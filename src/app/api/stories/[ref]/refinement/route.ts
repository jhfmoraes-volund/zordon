import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireCapabilityApi } from "@/lib/access/require-capability";
import {
  getStoryByReference,
  setStoryRefinement,
} from "@/lib/dal/story-hierarchy";

const patchSchema = z.object({
  status: z.enum(["draft", "committed"]),
});

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ ref: string }> },
) {
  const { ref } = await params;
  const story = await getStoryByReference(ref);
  if (!story) return new NextResponse("Not found", { status: 404 });

  const denied = await requireCapabilityApi("story.edit", {
    projectId: story.projectId,
  });
  if (denied) return denied;

  const body = await req.json().catch(() => null);
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.flatten() },
      { status: 400 },
    );
  }

  try {
    const updated = await setStoryRefinement(story.id, parsed.data.status);
    return NextResponse.json({ story: updated });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "update failed";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
