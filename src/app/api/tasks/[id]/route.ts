import { db } from "@/lib/db";
import { NextRequest, NextResponse } from "next/server";
import { getActorMemberId, getUser, requireProjectMemberApi } from "@/lib/dal";
import { isGuestActor, maskFPIfGuest } from "@/lib/guest-payload";
import { setTagsForTask } from "@/lib/dal/task-tags";
import {
  TASK_TAG_LIMIT,
  flattenTagEmbed,
  type TaskTagEmbedRow,
} from "@/lib/task-tags";
import { snapshotTaskHydrated } from "@/lib/dal/task-snapshot";
import { recordTaskChanges } from "@/lib/dal/task-activity-recorder";
import { notifyMembers } from "@/lib/dal/notifications";

const TASK_SELECT = `
  *,
  project:Project(name),
  sprint:Sprint(name),
  assignments:TaskAssignment(*, member:Member(id, name)),
  iterations:TaskIteration(id, number, type, trigger, resultSummary, success, startedAt, completedAt),
  tags:TaskTagAssignment(TaskTag(id, projectId, name, tone))
`;

async function fetchTask(id: string) {
  const supabase = db();
  const { data: task, error } = await supabase
    .from("Task")
    .select(TASK_SELECT)
    .eq("id", id)
    .single();
  if (error && error.code !== "PGRST116") return null;
  if (!task) return null;

  // Sort iterations desc and add _count
  const taskAny = task as typeof task & {
    iterations?: Array<{ startedAt: string }>;
    tags?: TaskTagEmbedRow[];
  };
  const iterations = taskAny.iterations ?? [];
  iterations.sort((a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime());
  const tags = flattenTagEmbed(taskAny.tags);
  return { ...task, iterations, tags, _count: { iterations: iterations.length } };
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getUser();
  if (!user) return new NextResponse("Unauthorized", { status: 401 });

  const { id } = await params;
  const task = await fetchTask(id);
  if (!task) {
    return NextResponse.json({ error: "Task not found" }, { status: 404 });
  }
  const guest = await isGuestActor();
  return NextResponse.json(maskFPIfGuest(task, guest));
}

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const { assigneeIds, tagIds, ...data } = await req.json();
  const supabase = db();

  const before = await snapshotTaskHydrated(id);
  if (!before) {
    return NextResponse.json({ error: "Task not found" }, { status: 404 });
  }

  const denied = await requireProjectMemberApi(before.task.projectId);
  if (denied) return denied;

  // Handle assignment updates
  if (assigneeIds !== undefined) {
    await supabase.from("TaskAssignment").delete().eq("taskId", id);
    if (assigneeIds.length > 0) {
      await supabase
        .from("TaskAssignment")
        .insert(assigneeIds.map((a: { memberId?: string }) => ({ id: crypto.randomUUID(), taskId: id, ...a })));
    }
  }

  if (Array.isArray(tagIds)) {
    if (tagIds.length > TASK_TAG_LIMIT) {
      return NextResponse.json(
        { error: `Task can have at most ${TASK_TAG_LIMIT} tags` },
        { status: 400 },
      );
    }
    await setTagsForTask(id, tagIds);
  }

  await supabase.from("Task").update(data).eq("id", id);
  const task = await fetchTask(id);

  const after = await snapshotTaskHydrated(id);
  if (after) {
    recordTaskChanges(id, before, after).catch((e) =>
      console.error("[task-activity] recordTaskChanges failed", e),
    );
    fanoutTaskNotifications(before, after).catch((e) =>
      console.error("[notifications] fanoutTaskNotifications failed", e),
    );
  }

  const guest = await isGuestActor();
  return NextResponse.json(task ? maskFPIfGuest(task, guest) : task);
}

async function fanoutTaskNotifications(
  before: NonNullable<Awaited<ReturnType<typeof snapshotTaskHydrated>>>,
  after: NonNullable<Awaited<ReturnType<typeof snapshotTaskHydrated>>>,
): Promise<void> {
  const actorMemberId = await getActorMemberId();
  const taskLabel = after.task.reference
    ? `${after.task.reference} · ${after.task.title}`
    : after.task.title;
  const basePayload = {
    title: taskLabel,
    projectId: after.task.projectId,
  };

  const newAssignees = after.assigneeIds.filter(
    (id) => !before.assigneeIds.includes(id),
  );
  if (newAssignees.length > 0) {
    await notifyMembers(newAssignees, {
      kind: "assigned",
      entityType: "task",
      entityId: after.task.id,
      actorMemberId,
      payload: basePayload,
    });
  }

  if (before.task.status !== after.task.status) {
    const watchers = new Set<string>(after.assigneeIds);
    if (after.task.createdById) watchers.add(after.task.createdById);
    await notifyMembers(Array.from(watchers), {
      kind: "status_changed",
      entityType: "task",
      entityId: after.task.id,
      actorMemberId,
      payload: {
        ...basePayload,
        fromStatus: before.task.status,
        toStatus: after.task.status,
      },
    });
  }
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const supabase = db();

  const { data: current } = await supabase
    .from("Task")
    .select("projectId")
    .eq("id", id)
    .maybeSingle();
  if (!current) {
    return NextResponse.json({ error: "Task not found" }, { status: 404 });
  }

  const denied = await requireProjectMemberApi(current.projectId);
  if (denied) return denied;

  // Soft delete — flag `dismissedAt`. The task drops out of the Inception
  // briefing tree but its history is preserved.
  const { error } = await supabase
    .from("Task")
    .update({
      dismissedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    })
    .eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, id });
}
