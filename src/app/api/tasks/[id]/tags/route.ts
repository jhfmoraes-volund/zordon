import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getUser, requireProjectMemberApi } from "@/lib/dal";
import { listTagsForTask, setTagsForTask } from "@/lib/dal/task-tags";
import { TASK_TAG_LIMIT } from "@/lib/task-tags";
import { snapshotTaskHydrated } from "@/lib/dal/task-snapshot";
import { recordTaskChanges } from "@/lib/dal/task-activity-recorder";

async function loadTaskOr404(taskId: string) {
  const { data } = await db()
    .from("Task")
    .select("id, projectId")
    .eq("id", taskId)
    .maybeSingle();
  return data;
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await getUser();
  if (!user) return new NextResponse("Unauthorized", { status: 401 });

  const { id: taskId } = await params;
  const task = await loadTaskOr404(taskId);
  if (!task) return NextResponse.json({ error: "Task not found" }, { status: 404 });

  const denied = await requireProjectMemberApi(task.projectId);
  if (denied) return denied;

  const tags = await listTagsForTask(taskId);
  return NextResponse.json(tags);
}

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await getUser();
  if (!user) return new NextResponse("Unauthorized", { status: 401 });

  const { id: taskId } = await params;
  const task = await loadTaskOr404(taskId);
  if (!task) return NextResponse.json({ error: "Task not found" }, { status: 404 });

  const denied = await requireProjectMemberApi(task.projectId);
  if (denied) return denied;

  const body = await req.json().catch(() => null);
  if (!body || !Array.isArray(body.tagIds)) {
    return NextResponse.json(
      { error: "Expected { tagIds: string[] }" },
      { status: 400 },
    );
  }
  if (body.tagIds.length > TASK_TAG_LIMIT) {
    return NextResponse.json(
      { error: `Task can have at most ${TASK_TAG_LIMIT} tags` },
      { status: 400 },
    );
  }

  try {
    const before = await snapshotTaskHydrated(taskId);
    await setTagsForTask(taskId, body.tagIds);
    const tags = await listTagsForTask(taskId);
    if (before) {
      const after = await snapshotTaskHydrated(taskId);
      if (after) {
        recordTaskChanges(taskId, before, after).catch((e) =>
          console.error("[task-activity] recordTaskChanges failed", e),
        );
      }
    }
    return NextResponse.json(tags);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Failed to set tags";
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}
