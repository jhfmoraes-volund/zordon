import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  requireProjectViewApi,
  requireProjectEditTasksApi,
} from "@/lib/dal";
import { db } from "@/lib/db";
import {
  dismissStory,
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
    refinementStatus: z.enum(["draft", "committed"]).optional(),
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
    .is("dismissedAt", null)
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

  // Soft delete (sets `dismissedAt`). Allowed for anyone who can edit tasks
  // in the project — builders need to descartar indicações do Vitor dentro do
  // briefing. Underlying data is preserved.
  const denied = await requireProjectEditTasksApi(story.projectId);
  if (denied) return denied;

  try {
    await dismissStory(story.id);
    return NextResponse.json({ ok: true, id: story.id, reference: ref });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "delete failed";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
