import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import {
  getActorMemberId,
  requireProjectEditTasksApi,
} from "@/lib/dal";
import { getAcForTask, createAc } from "@/lib/dal/story-hierarchy";
import { createActivity } from "@/lib/dal/task-activity";
import type { Database } from "@/lib/supabase/database.types";

type TaskRow = Database["public"]["Tables"]["Task"]["Row"];

const TASK_STATUSES = [
  "draft",
  "backlog",
  "todo",
  "in_progress",
  "review",
  "done",
] as const;

const bodySchema = z.object({
  sprintId: z.string().uuid().nullable().optional(),
  status: z.enum(TASK_STATUSES).optional(),
});

const SELECT_FULL = `
  *,
  project:Project(name),
  sprint:Sprint(name),
  assignments:TaskAssignment(*, member:Member(id, name))
`;

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const supabase = db();

  const { data: source } = await supabase
    .from("Task")
    .select("*")
    .eq("id", id)
    .maybeSingle<TaskRow>();
  if (!source) {
    return NextResponse.json({ error: "Task not found" }, { status: 404 });
  }

  const denied = await requireProjectEditTasksApi(source.projectId);
  if (denied) return denied;

  const parsed = bodySchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.flatten() },
      { status: 400 },
    );
  }
  const { sprintId = null, status = "backlog" } = parsed.data;

  const acs = await getAcForTask(id);
  const actorMemberId = await getActorMemberId();
  const newId = crypto.randomUUID();

  let reference: string | null = null;
  for (let attempt = 0; attempt < 5; attempt++) {
    const { data: ref } = await supabase.rpc("next_task_reference");
    reference = ref ?? null;
    if (!reference) {
      return NextResponse.json(
        { error: "Could not generate unique task reference" },
        { status: 500 },
      );
    }

    const { error } = await supabase.from("Task").insert({
      id: newId,
      reference,
      title: `${source.title} (cópia)`,
      description: source.description,
      type: source.type,
      scope: source.scope,
      complexity: source.complexity,
      area: source.area,
      functionPoints: source.functionPoints,
      billable: source.billable,
      notes: source.notes,
      acceptanceCriteria: source.acceptanceCriteria,
      projectId: source.projectId,
      userStoryId: source.userStoryId,
      sprintId,
      status,
      priority: source.priority,
      createdById: actorMemberId,
      createdByAgent: false,
      updatedAt: new Date().toISOString(),
    });

    if (!error) break;
    if (error.code === "23505" && error.message?.includes("reference")) {
      continue;
    }
    console.error("[POST /api/tasks/:id/duplicate] insert failed", error);
    return NextResponse.json(
      { error: error.message || "Failed to duplicate task" },
      { status: 500 },
    );
  }

  for (const ac of acs) {
    await createAc({
      taskId: newId,
      text: ac.text,
      order: ac.order,
    });
  }

  await createActivity({
    taskId: id,
    type: "duplicated",
    payload: {
      newTaskId: newId,
      newTaskRef: reference,
      sprintId,
      status,
    },
    actorMemberId,
  });

  const { data: full } = await supabase
    .from("Task")
    .select(SELECT_FULL)
    .eq("id", newId)
    .single();

  return NextResponse.json(full, { status: 201 });
}
