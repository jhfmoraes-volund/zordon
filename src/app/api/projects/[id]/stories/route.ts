import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireProjectViewApi, getActorMemberId } from "@/lib/dal";
import { requireCapabilityApi } from "@/lib/access/require-capability";
import {
  createStory,
  getStoriesForProject,
} from "@/lib/dal/story-hierarchy";

const moduleNameRe = /^[A-Z][A-Z0-9_]*$/;

const createSchema = z
  .object({
    moduleId: z.string().nullable().optional(),
    proposedModuleName: z
      .string()
      .regex(moduleNameRe, "Use UPPERCASE_SNAKE")
      .nullable()
      .optional(),
    personaId: z.string().nullable().optional(),
    title: z.string().min(3).max(160),
    want: z.string().min(3).max(500),
    soThat: z.string().nullable().optional(),
    // Default 'draft' (estado de trabalho normal, via createStory). 'committed'
    // pode ser passado explicitamente para nascer já travado.
    refinementStatus: z.enum(["draft", "committed"]).optional(),
    acceptanceCriteria: z.array(z.string().min(1).max(500)).optional(),
  })
  .refine(
    (d) =>
      !(d.moduleId && d.proposedModuleName) /* xor: both set is invalid */,
    { message: "moduleId XOR proposedModuleName" },
  );

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const denied = await requireProjectViewApi(id);
  if (denied) return denied;

  const stories = await getStoriesForProject(id);
  return NextResponse.json({ stories });
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const denied = await requireCapabilityApi("story.edit", { projectId: id });
  if (denied) return denied;

  const body = await req.json().catch(() => null);
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const memberId = await getActorMemberId();

  try {
    const story = await createStory({
      projectId: id,
      ...parsed.data,
      createdById: memberId,
      createdByAgent: false,
    });
    return NextResponse.json({ story }, { status: 201 });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "create failed";
    const status = /referenceKey/i.test(msg) ? 400 : 500;
    return NextResponse.json({ error: msg }, { status });
  }
}
