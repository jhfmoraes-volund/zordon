import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireProjectEditTasksApi } from "@/lib/dal";
import { setTaskUserStory } from "@/lib/dal/story-hierarchy";

const bodySchema = z.object({
  userStoryId: z.string().nullable(),
});

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  const { data: task } = await db()
    .from("Task")
    .select("projectId")
    .eq("id", id)
    .maybeSingle();
  if (!task) return new NextResponse("Not found", { status: 404 });

  const denied = await requireProjectEditTasksApi(task.projectId);
  if (denied) return denied;

  const body = await req.json().catch(() => null);
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.flatten() },
      { status: 400 },
    );
  }

  // If userStoryId provided, ensure it's in the same project.
  if (parsed.data.userStoryId) {
    const { data: story } = await db()
      .from("UserStory")
      .select("projectId")
      .eq("id", parsed.data.userStoryId)
      .maybeSingle();
    if (!story) {
      return NextResponse.json(
        { error: "userStory not found" },
        { status: 404 },
      );
    }
    if (story.projectId !== task.projectId) {
      return NextResponse.json(
        { error: "userStory belongs to a different project" },
        { status: 400 },
      );
    }
  }

  try {
    const updated = await setTaskUserStory(id, parsed.data.userStoryId);
    return NextResponse.json({ task: updated });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "update failed";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
