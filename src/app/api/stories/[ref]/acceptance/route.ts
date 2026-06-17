import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  requireProjectEditTasksApi,
  requireProjectViewApi,
} from "@/lib/dal";
import {
  createAc,
  getAcForStory,
  getStoryByReference,
} from "@/lib/dal/story-hierarchy";

const createSchema = z.object({
  // Empty is allowed: the UI creates a blank AC stub on "Adicionar critério"
  // and persists the text inline on blur (mirrors the task acceptance route).
  text: z.string().max(500),
  order: z.number().int().min(0).optional(),
});

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ ref: string }> },
) {
  const { ref } = await params;
  const story = await getStoryByReference(ref);
  if (!story) return new NextResponse("Not found", { status: 404 });

  const denied = await requireProjectViewApi(story.projectId);
  if (denied) return denied;

  const acceptance = await getAcForStory(story.id);
  return NextResponse.json({ acceptance });
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ ref: string }> },
) {
  const { ref } = await params;
  const story = await getStoryByReference(ref);
  if (!story) return new NextResponse("Not found", { status: 404 });

  const denied = await requireProjectEditTasksApi(story.projectId);
  if (denied) return denied;

  const body = await req.json().catch(() => null);
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.flatten() },
      { status: 400 },
    );
  }

  try {
    const ac = await createAc({
      userStoryId: story.id,
      text: parsed.data.text,
      order: parsed.data.order ?? 0,
    });
    return NextResponse.json({ acceptance: ac }, { status: 201 });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "create failed";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
