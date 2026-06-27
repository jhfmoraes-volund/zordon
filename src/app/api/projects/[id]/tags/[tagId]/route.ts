import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getUser } from "@/lib/dal";
import { requireCapabilityApi } from "@/lib/access/require-capability";
import { deleteTag, recolorTag, renameTag } from "@/lib/dal/task-tags";
import { TAG_TONES } from "@/lib/task-tags";

async function loadTagOr404(tagId: string) {
  const { data } = await db()
    .from("TaskTag")
    .select("id, projectId")
    .eq("id", tagId)
    .maybeSingle();
  return data;
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; tagId: string }> },
) {
  const user = await getUser();
  if (!user) return new NextResponse("Unauthorized", { status: 401 });

  const { tagId } = await params;
  const tag = await loadTagOr404(tagId);
  if (!tag) return NextResponse.json({ error: "Tag not found" }, { status: 404 });

  const denied = await requireCapabilityApi("project.content_edit", {
    projectId: tag.projectId,
  });
  if (denied) return denied;

  const body = await req.json().catch(() => null);
  if (!body || (body.name === undefined && body.tone === undefined)) {
    return NextResponse.json(
      { error: "Expected { name?: string, tone?: string }" },
      { status: 400 },
    );
  }

  try {
    let updated;
    if (typeof body.name === "string") {
      updated = await renameTag(tagId, body.name);
    }
    if (typeof body.tone === "string") {
      if (!(TAG_TONES as readonly string[]).includes(body.tone)) {
        return NextResponse.json({ error: "Invalid tone" }, { status: 400 });
      }
      updated = await recolorTag(tagId, body.tone);
    }
    return NextResponse.json(updated);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Failed to update tag";
    const isDuplicate =
      typeof e === "object" && e !== null && "code" in e && e.code === "23505";
    return NextResponse.json(
      { error: isDuplicate ? "Tag with this name already exists" : msg },
      { status: isDuplicate ? 409 : 400 },
    );
  }
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; tagId: string }> },
) {
  const user = await getUser();
  if (!user) return new NextResponse("Unauthorized", { status: 401 });

  const { tagId } = await params;
  const tag = await loadTagOr404(tagId);
  if (!tag) return NextResponse.json({ error: "Tag not found" }, { status: 404 });

  const denied = await requireCapabilityApi("project.content_edit", {
    projectId: tag.projectId,
  });
  if (denied) return denied;

  await deleteTag(tagId);
  return NextResponse.json({ ok: true });
}
