import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getActorMemberId } from "@/lib/dal";
import { requireCapabilityApi } from "@/lib/access/require-capability";
import {
  deleteAc,
  getStoryByReference,
  toggleAcCheck,
  updateAc,
} from "@/lib/dal/story-hierarchy";

const patchSchema = z.object({
  text: z.string().max(500).optional(),
  order: z.number().int().min(0).optional(),
  checked: z.boolean().optional(),
});

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ ref: string; acId: string }> },
) {
  const { ref, acId } = await params;
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
    let acceptance;
    if (parsed.data.checked !== undefined) {
      const memberId = await getActorMemberId();
      if (!memberId) {
        return NextResponse.json(
          { error: "checker must be a Member" },
          { status: 400 },
        );
      }
      acceptance = await toggleAcCheck(acId, memberId, parsed.data.checked);
    }
    if (parsed.data.text !== undefined || parsed.data.order !== undefined) {
      acceptance = await updateAc(acId, {
        text: parsed.data.text,
        order: parsed.data.order,
      });
    }
    return NextResponse.json({ acceptance });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "update failed";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ ref: string; acId: string }> },
) {
  const { ref, acId } = await params;
  const story = await getStoryByReference(ref);
  if (!story) return new NextResponse("Not found", { status: 404 });

  const denied = await requireCapabilityApi("story.edit", {
    projectId: story.projectId,
  });
  if (denied) return denied;

  try {
    await deleteAc(acId);
    return new NextResponse(null, { status: 204 });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "delete failed";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
