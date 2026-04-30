import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  requireProjectViewApi,
  requireMinLevelApi,
} from "@/lib/dal";
import { MANAGER } from "@/lib/roles";
import {
  createModule,
  getModulesForProject,
} from "@/lib/dal/story-hierarchy";

const moduleNameRe = /^[A-Z][A-Z0-9_]*$/;

const createSchema = z.object({
  name: z.string().min(1).regex(moduleNameRe, "Use UPPERCASE_SNAKE"),
  description: z.string().nullable().optional(),
});

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const denied = await requireProjectViewApi(id);
  if (denied) return denied;

  const modules = await getModulesForProject(id);
  return NextResponse.json({ modules });
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const denied = await requireMinLevelApi(MANAGER);
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
    const mod = await createModule({ projectId: id, ...parsed.data });
    return NextResponse.json({ module: mod }, { status: 201 });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "create failed";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
