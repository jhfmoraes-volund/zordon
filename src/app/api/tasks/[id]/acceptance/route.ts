import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireProjectViewApi } from "@/lib/dal";
import { requireCapabilityApi } from "@/lib/access/require-capability";
import { createAc, getAcForTask } from "@/lib/dal/story-hierarchy";
import { snapshotAcceptance } from "@/lib/dal/task-snapshot";
import {
  diffAcceptance,
  recordAcceptanceChanges,
} from "@/lib/dal/task-activity-recorder";

const createSchema = z.object({
  text: z.string().max(500),
  order: z.number().int().min(0).optional(),
});

async function fetchTaskProjectId(id: string): Promise<string | null> {
  const { data } = await db()
    .from("Task")
    .select("projectId")
    .eq("id", id)
    .maybeSingle();
  return data?.projectId ?? null;
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const projectId = await fetchTaskProjectId(id);
  if (!projectId) return new NextResponse("Not found", { status: 404 });

  const denied = await requireProjectViewApi(projectId);
  if (denied) return denied;

  const acceptance = await getAcForTask(id);
  return NextResponse.json({ acceptance });
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const projectId = await fetchTaskProjectId(id);
  if (!projectId) return new NextResponse("Not found", { status: 404 });

  const denied = await requireCapabilityApi("task.edit", { projectId });
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
    const before = await snapshotAcceptance(id);
    const ac = await createAc({
      taskId: id,
      text: parsed.data.text,
      order: parsed.data.order ?? 0,
    });
    const after = await snapshotAcceptance(id);
    recordAcceptanceChanges(id, diffAcceptance(before, after)).catch((e) =>
      console.error("[task-activity] recordAcceptanceChanges failed", e),
    );
    return NextResponse.json({ acceptance: ac }, { status: 201 });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "create failed";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
