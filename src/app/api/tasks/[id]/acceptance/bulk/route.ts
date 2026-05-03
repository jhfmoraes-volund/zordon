import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import {
  getActorMemberId,
  requireProjectEditTasksApi,
} from "@/lib/dal";
import { snapshotAcceptance } from "@/lib/dal/task-snapshot";
import {
  diffAcceptance,
  recordAcceptanceChanges,
} from "@/lib/dal/task-activity-recorder";

const createSchema = z.object({
  id: z.string().uuid().optional(),
  text: z.string().max(500),
  order: z.number().int().min(0).optional(),
});

const updateSchema = z.object({
  id: z.string().uuid(),
  text: z.string().max(500).optional(),
  order: z.number().int().min(0).optional(),
  checked: z.boolean().optional(),
});

const bodySchema = z.object({
  creates: z.array(createSchema).optional(),
  updates: z.array(updateSchema).optional(),
  deletes: z.array(z.string().uuid()).optional(),
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
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const projectId = await fetchTaskProjectId(id);
  if (!projectId) return new NextResponse("Not found", { status: 404 });

  const denied = await requireProjectEditTasksApi(projectId);
  if (denied) return denied;

  const json = await req.json().catch(() => null);
  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const memberId = await getActorMemberId();

  const updates = (parsed.data.updates ?? []).map((u) =>
    u.checked === undefined
      ? u
      : { ...u, checkedBy: u.checked ? memberId ?? null : null },
  );

  const payload = {
    creates: parsed.data.creates ?? [],
    updates,
    deletes: parsed.data.deletes ?? [],
  };

  const before = await snapshotAcceptance(id);

  const { data, error } = await db().rpc("task_acceptance_bulk_diff", {
    p_task_id: id,
    p_payload: payload,
  });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const after = await snapshotAcceptance(id);
  recordAcceptanceChanges(id, diffAcceptance(before, after)).catch((e) =>
    console.error("[task-activity] recordAcceptanceChanges failed", e),
  );

  return NextResponse.json({ acceptance: data ?? [] });
}
