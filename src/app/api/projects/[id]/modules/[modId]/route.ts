import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireCapabilityApi } from "@/lib/access/require-capability";
import { deleteModule, updateModule } from "@/lib/dal/story-hierarchy";

const moduleNameRe = /^[A-Z][A-Z0-9_]*$/;
const patchSchema = z.object({
  name: z.string().min(1).regex(moduleNameRe).optional(),
  description: z.string().nullable().optional(),
});

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; modId: string }> },
) {
  const { id: projectId, modId } = await params;
  const denied = await requireCapabilityApi("project.content_edit", {
    projectId,
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
    const mod = await updateModule(modId, parsed.data);
    return NextResponse.json({ module: mod });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "update failed";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; modId: string }> },
) {
  const { id: projectId, modId } = await params;
  const denied = await requireCapabilityApi("project.content_edit", {
    projectId,
  });
  if (denied) return denied;

  try {
    await deleteModule(modId);
    return new NextResponse(null, { status: 204 });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "delete failed";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
