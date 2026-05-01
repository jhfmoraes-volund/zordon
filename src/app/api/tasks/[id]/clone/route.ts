import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import {
  getActorMemberId,
  requireProjectEditTasksApi,
  requireProjectViewApi,
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
  targetProjectId: z.string().uuid(),
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
    .select("*, project:Project(id, name)")
    .eq("id", id)
    .maybeSingle<TaskRow & { project: { id: string; name: string } | null }>();
  if (!source) {
    return NextResponse.json({ error: "Task not found" }, { status: 404 });
  }

  // Read access on source project
  const deniedSource = await requireProjectViewApi(source.projectId);
  if (deniedSource) return deniedSource;

  const parsed = bodySchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.flatten() },
      { status: 400 },
    );
  }
  const { targetProjectId, status = "backlog" } = parsed.data;

  if (targetProjectId === source.projectId) {
    return NextResponse.json(
      { error: "Use duplicate to copy within the same project" },
      { status: 400 },
    );
  }

  // Edit access on target project
  const deniedTarget = await requireProjectEditTasksApi(targetProjectId);
  if (deniedTarget) return deniedTarget;

  const { data: targetProject } = await supabase
    .from("Project")
    .select("id, name")
    .eq("id", targetProjectId)
    .maybeSingle();
  if (!targetProject) {
    return NextResponse.json(
      { error: "Target project not found" },
      { status: 404 },
    );
  }

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
      title: source.title,
      description: source.description,
      type: source.type,
      scope: source.scope,
      complexity: source.complexity,
      area: source.area,
      functionPoints: source.functionPoints,
      billable: source.billable,
      notes: source.notes,
      acceptanceCriteria: source.acceptanceCriteria,
      projectId: targetProjectId,
      userStoryId: null,
      sprintId: null,
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
    console.error("[POST /api/tasks/:id/clone] insert failed", error);
    return NextResponse.json(
      { error: error.message || "Failed to clone task" },
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
    type: "cloned_to",
    payload: {
      targetProjectId,
      targetProjectName: targetProject.name,
      newTaskId: newId,
      newTaskRef: reference,
    },
    actorMemberId,
  });

  await createActivity({
    taskId: newId,
    type: "cloned_from",
    payload: {
      sourceProjectId: source.projectId,
      sourceProjectName: source.project?.name ?? null,
      sourceTaskId: id,
      sourceTaskRef: source.reference,
    },
    actorMemberId,
  });

  const { data: full } = await supabase
    .from("Task")
    .select(SELECT_FULL)
    .eq("id", newId)
    .single();

  return NextResponse.json(
    { task: full, targetProjectName: targetProject.name },
    { status: 201 },
  );
}
