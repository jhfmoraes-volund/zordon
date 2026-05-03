import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import {
  getActorMemberId,
  requireProjectEditTasksApi,
} from "@/lib/dal";
import { deleteAc, toggleAcCheck, updateAc } from "@/lib/dal/story-hierarchy";
import { snapshotAcceptance } from "@/lib/dal/task-snapshot";
import {
  diffAcceptance,
  recordAcceptanceChanges,
} from "@/lib/dal/task-activity-recorder";

const patchSchema = z.object({
  text: z.string().max(500).optional(),
  order: z.number().int().min(0).optional(),
  checked: z.boolean().optional(),
});

async function fetchTaskProjectId(id: string): Promise<string | null> {
  const { data } = await db()
    .from("Task")
    .select("projectId")
    .eq("id", id)
    .maybeSingle();
  return data?.projectId ?? null;
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; acId: string }> },
) {
  const { id, acId } = await params;
  const projectId = await fetchTaskProjectId(id);
  if (!projectId) return new NextResponse("Not found", { status: 404 });

  const denied = await requireProjectEditTasksApi(projectId);
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
    const before = await snapshotAcceptance(id);
    let acceptance;
    if (parsed.data.checked !== undefined) {
      const memberId = await getActorMemberId();
      if (!memberId) {
        return NextResponse.json(
          { error: "checker must be a Member" },
          { status: 400 },
        );
      }
      acceptance = await toggleAcCheck(acId, memberId, parsed.data.checked);
    }
    if (parsed.data.text !== undefined || parsed.data.order !== undefined) {
      acceptance = await updateAc(acId, {
        text: parsed.data.text,
        order: parsed.data.order,
      });
    }
    const after = await snapshotAcceptance(id);
    recordAcceptanceChanges(id, diffAcceptance(before, after)).catch((e) =>
      console.error("[task-activity] recordAcceptanceChanges failed", e),
    );
    return NextResponse.json({ acceptance });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "update failed";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; acId: string }> },
) {
  const { id, acId } = await params;
  const projectId = await fetchTaskProjectId(id);
  if (!projectId) return new NextResponse("Not found", { status: 404 });

  const denied = await requireProjectEditTasksApi(projectId);
  if (denied) return denied;

  try {
    const before = await snapshotAcceptance(id);
    await deleteAc(acId);
    const after = await snapshotAcceptance(id);
    recordAcceptanceChanges(id, diffAcceptance(before, after)).catch((e) =>
      console.error("[task-activity] recordAcceptanceChanges failed", e),
    );
    return NextResponse.json({ ok: true, id: acId });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "delete failed";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
