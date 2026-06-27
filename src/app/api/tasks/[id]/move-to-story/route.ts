import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireCapabilityApi } from "@/lib/access/require-capability";
import { setTaskUserStory } from "@/lib/dal/story-hierarchy";
import { snapshotTaskHydrated } from "@/lib/dal/task-snapshot";
import { recordTaskChanges } from "@/lib/dal/task-activity-recorder";

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

  const denied = await requireCapabilityApi("task.edit", { projectId: task.projectId });
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
    const before = await snapshotTaskHydrated(id);
    const updated = await setTaskUserStory(id, parsed.data.userStoryId);
    if (before) {
      const after = await snapshotTaskHydrated(id);
      if (after) {
        recordTaskChanges(id, before, after).catch((e) =>
          console.error("[task-activity] recordTaskChanges failed", e),
        );
      }
    }
    return NextResponse.json({ task: updated });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "update failed";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
