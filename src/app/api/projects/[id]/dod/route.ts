import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireCapabilityApi } from "@/lib/access/require-capability";
import { setDefinitionOfDone } from "@/lib/dal/story-hierarchy";

const patchSchema = z.object({
  items: z.array(z.string().min(1).max(500)).max(20),
});

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const denied = await requireCapabilityApi("project.configure", {
    projectId: id,
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
    const project = await setDefinitionOfDone(id, parsed.data.items);
    return NextResponse.json({
      definitionOfDone: project.definitionOfDone,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "update failed";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
