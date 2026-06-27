import { NextRequest, NextResponse } from "next/server";
import { getUser, requireProjectMemberApi } from "@/lib/dal";
import { requireCapabilityApi } from "@/lib/access/require-capability";
import { createTag, listTagsForProject } from "@/lib/dal/task-tags";
import { TAG_TONES } from "@/lib/task-tags";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await getUser();
  if (!user) return new NextResponse("Unauthorized", { status: 401 });

  const { id: projectId } = await params;
  const denied = await requireProjectMemberApi(projectId);
  if (denied) return denied;

  const tags = await listTagsForProject(projectId);
  return NextResponse.json(tags);
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await getUser();
  if (!user) return new NextResponse("Unauthorized", { status: 401 });

  const { id: projectId } = await params;
  const denied = await requireCapabilityApi("project.content_edit", {
    projectId,
  });
  if (denied) return denied;

  const body = await req.json().catch(() => null);
  if (!body || typeof body.name !== "string" || typeof body.tone !== "string") {
    return NextResponse.json(
      { error: "Expected { name: string, tone: string }" },
      { status: 400 },
    );
  }
  if (!(TAG_TONES as readonly string[]).includes(body.tone)) {
    return NextResponse.json({ error: "Invalid tone" }, { status: 400 });
  }

  try {
    const tag = await createTag({
      projectId,
      name: body.name,
      tone: body.tone,
    });
    return NextResponse.json(tag, { status: 201 });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Failed to create tag";
    const isDuplicate =
      typeof e === "object" && e !== null && "code" in e && e.code === "23505";
    return NextResponse.json(
      { error: isDuplicate ? "Tag with this name already exists" : msg },
      { status: isDuplicate ? 409 : 400 },
    );
  }
}
