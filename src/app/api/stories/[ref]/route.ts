import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  requireProjectViewApi,
  requireProjectEditTasksApi,
} from "@/lib/dal";
import { db } from "@/lib/db";
import {
  deleteStory,
  getStoryByReference,
  updateStory,
} from "@/lib/dal/story-hierarchy";

const moduleNameRe = /^[A-Z][A-Z0-9_]*$/;

const patchSchema = z
  .object({
    moduleId: z.string().nullable().optional(),
    proposedModuleName: z
      .string()
      .regex(moduleNameRe, "Use UPPERCASE_SNAKE")
      .nullable()
      .optional(),
    personaId: z.string().nullable().optional(),
    title: z.string().min(3).max(160).optional(),
    want: z.string().min(3).max(500).optional(),
    soThat: z.string().nullable().optional(),
    refinementStatus: z.enum(["draft", "refined", "committed"]).optional(),
  })
  .refine((d) => !(d.moduleId && d.proposedModuleName), {
    message: "moduleId XOR proposedModuleName",
  });

async function resolveStory(reference: string) {
  const story = await getStoryByReference(reference);
  if (!story) return null;
  return story;
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ ref: string }> },
) {
  const { ref } = await params;
  const story = await resolveStory(ref);
  if (!story) return new NextResponse("Not found", { status: 404 });

  const denied = await requireProjectViewApi(story.projectId);
  if (denied) return denied;

  const { data: tasks, error } = await db()
    .from("Task")
    .select(
      "*, assignments:TaskAssignment(*, member:Member(id, name)), acceptanceCriteria:AcceptanceCriterion!AcceptanceCriterion_taskId_fkey(*)",
    )
    .eq("userStoryId", story.id)
    .order("createdAt");
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ story, tasks: tasks ?? [] });
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ ref: string }> },
) {
  const { ref } = await params;
  const story = await resolveStory(ref);
  if (!story) return new NextResponse("Not found", { status: 404 });

  const denied = await requireProjectEditTasksApi(story.projectId);
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
    const updated = await updateStory(story.id, parsed.data);
    return NextResponse.json({ story: updated });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "update failed";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ ref: string }> },
) {
  const { ref } = await params;
  const story = await resolveStory(ref);
  if (!story) return new NextResponse("Not found", { status: 404 });

  // Delete is manager-only (mirror RLS).
  const { requireMinLevelApi } = await import("@/lib/dal");
  const { MANAGER } = await import("@/lib/roles");
  const denied = await requireMinLevelApi(MANAGER);
  if (denied) return denied;

  try {
    await deleteStory(story.id);
    return new NextResponse(null, { status: 204 });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "delete failed";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
