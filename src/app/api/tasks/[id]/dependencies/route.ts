import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireProjectViewApi } from "@/lib/dal";
import { requireCapabilityApi } from "@/lib/access/require-capability";
import {
  DEPENDENCY_KINDS,
  listDependenciesForTask,
  listDependentsOfTask,
  resolveDependencyInputs,
  setDependenciesForTask,
} from "@/lib/dal/task-dependencies";

const bodySchema = z.object({
  dependsOn: z.array(
    z.union([
      z.string().min(1),
      z.object({
        ref: z.string().min(1),
        kind: z.enum(DEPENDENCY_KINDS).optional(),
      }),
    ]),
  ),
});

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const supabase = db();

  const { data: task, error } = await supabase
    .from("Task")
    .select("id, projectId")
    .eq("id", id)
    .maybeSingle();
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if (!task) {
    return NextResponse.json({ error: "Task not found" }, { status: 404 });
  }

  const denied = await requireProjectViewApi(task.projectId);
  if (denied) return denied;

  const [outgoing, incoming] = await Promise.all([
    listDependenciesForTask(id),
    listDependentsOfTask(id),
  ]);

  return NextResponse.json({
    dependsOn: outgoing,
    dependents: incoming,
  });
}

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const supabase = db();

  const { data: task, error } = await supabase
    .from("Task")
    .select("id, projectId")
    .eq("id", id)
    .maybeSingle();
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if (!task) {
    return NextResponse.json({ error: "Task not found" }, { status: 404 });
  }

  const denied = await requireCapabilityApi("task.edit", { projectId: task.projectId });
  if (denied) return denied;

  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.flatten() },
      { status: 400 },
    );
  }

  if (parsed.data.dependsOn.length === 0) {
    try {
      await setDependenciesForTask(id, []);
    } catch (e) {
      return NextResponse.json(
        { error: e instanceof Error ? e.message : String(e) },
        { status: 500 },
      );
    }
    return NextResponse.json({ dependsOn: [], dependents: [] });
  }

  const { resolved, missing } = await resolveDependencyInputs(
    task.projectId,
    parsed.data.dependsOn,
  );
  if (missing.length > 0) {
    return NextResponse.json(
      {
        error: `Refs nao encontradas neste projeto: ${missing.join(", ")}`,
      },
      { status: 422 },
    );
  }

  try {
    await setDependenciesForTask(
      id,
      resolved.map((r) => ({ dependsOn: r.dependsOn, kind: r.kind })),
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    // Trigger lança "Cycle detected" — surface clean status.
    if (msg.toLowerCase().includes("cycle")) {
      return NextResponse.json(
        { error: "Dependencia criaria ciclo de blocks" },
        { status: 422 },
      );
    }
    return NextResponse.json({ error: msg }, { status: 500 });
  }

  const [outgoing, incoming] = await Promise.all([
    listDependenciesForTask(id),
    listDependentsOfTask(id),
  ]);

  return NextResponse.json({
    dependsOn: outgoing,
    dependents: incoming,
  });
}
