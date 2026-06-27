import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireCapabilityApi } from "@/lib/access/require-capability";
import { deletePersona, updatePersona } from "@/lib/dal/story-hierarchy";

const patchSchema = z.object({
  name: z.string().min(1).max(80).optional(),
  description: z.string().nullable().optional(),
});

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; perId: string }> },
) {
  const { id: projectId, perId } = await params;
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
    const persona = await updatePersona(perId, parsed.data);
    return NextResponse.json({ persona });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "update failed";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; perId: string }> },
) {
  const { id: projectId, perId } = await params;
  const denied = await requireCapabilityApi("project.content_edit", {
    projectId,
  });
  if (denied) return denied;

  try {
    await deletePersona(perId);
    return new NextResponse(null, { status: 204 });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "delete failed";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
