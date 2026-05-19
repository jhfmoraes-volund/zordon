import { db } from "@/lib/db";
import { NextRequest, NextResponse } from "next/server";
import { getAccessLevel, getUser } from "@/lib/dal";
import { hasMinAccessLevel } from "@/lib/roles";
import type { Database } from "@/lib/supabase/database.types";

type SprintUpdate = Database["public"]["Tables"]["Sprint"]["Update"];

const ALLOWED_FIELDS = [
  "name",
  "startDate",
  "endDate",
  "status",
  "goal",
  "deployedToStagingAt",
  "deployedToProductionAt",
] as const satisfies readonly (keyof SprintUpdate)[];

const GOAL_MAX_LENGTH = 280;

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getUser();
  if (!user) return new NextResponse("Unauthorized", { status: 401 });

  const { id } = await params;
  const body = await req.json();

  if (body.status === "active") {
    return NextResponse.json(
      { error: "Use POST /api/sprints/[id]/activate para ativar uma sprint" },
      { status: 400 }
    );
  }

  if (body.status === "completed") {
    return NextResponse.json(
      { error: "Use POST /api/sprints/[id]/complete para concluir uma sprint" },
      { status: 400 }
    );
  }

  const update: SprintUpdate = {};
  for (const key of ALLOWED_FIELDS) {
    if (key in body) (update as Record<string, unknown>)[key] = body[key];
  }

  if (typeof update.goal === "string" && update.goal.length > GOAL_MAX_LENGTH) {
    return NextResponse.json(
      { error: `Goal deve ter no máximo ${GOAL_MAX_LENGTH} caracteres` },
      { status: 400 }
    );
  }
  if (typeof update.goal === "string" && update.goal.trim() === "") {
    update.goal = null;
  }

  const { data: sprint, error } = await db()
    .from("Sprint")
    .update(update)
    .eq("id", id)
    .select()
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(sprint);
}

/**
 * DELETE /api/sprints/:id
 *
 * O Sprint tem um trigger (sprint_block_delete_with_tasks) que bloqueia o
 * DELETE quando há tasks vinculadas. Pra deletar uma sprint com tasks, o
 * cliente declara o que fazer com elas via body:
 *
 *   - `{ taskAction: "moveToBacklog" }` → seta sprintId = null nas tasks
 *     e depois deleta a sprint. Tasks ficam no backlog do projeto.
 *   - `{ taskAction: "delete" }` → deleta as tasks (cascade pra AC/tags via
 *     FKs) e depois a sprint.
 *   - Sem body / `taskAction` ausente → comportamento legado: tenta deletar
 *     direto; se o trigger bloquear, retorna 409.
 */
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getUser();
  if (!user) return new NextResponse("Unauthorized", { status: 401 });

  const accessLevel = await getAccessLevel();
  if (!hasMinAccessLevel(accessLevel, "manager")) {
    return NextResponse.json({ error: "Apenas PMs e admins podem excluir sprints." }, { status: 403 });
  }

  const { id } = await params;

  let taskAction: "moveToBacklog" | "delete" | null = null;
  try {
    const body = await req.json();
    if (body?.taskAction === "moveToBacklog" || body?.taskAction === "delete") {
      taskAction = body.taskAction;
    }
  } catch {
    // sem body é OK — segue caminho legado
  }

  const client = db();

  if (taskAction === "moveToBacklog") {
    const { error: moveErr } = await client
      .from("Task")
      .update({
        sprintId: null,
        status: "backlog",
        updatedAt: new Date().toISOString(),
      })
      .eq("sprintId", id);
    if (moveErr) {
      return NextResponse.json(
        { error: `Falha ao mover tasks pro backlog: ${moveErr.message}` },
        { status: 500 },
      );
    }
  } else if (taskAction === "delete") {
    const { error: delTasksErr } = await client
      .from("Task")
      .delete()
      .eq("sprintId", id);
    if (delTasksErr) {
      return NextResponse.json(
        { error: `Falha ao excluir tasks da sprint: ${delTasksErr.message}` },
        { status: 500 },
      );
    }
  }

  const { error } = await client.from("Sprint").delete().eq("id", id);
  if (error) {
    // Trigger sprint_block_delete_with_tasks levanta P0001 com prefixo "sprint_has_tasks:".
    if (error.message?.includes("sprint_has_tasks")) {
      return NextResponse.json(
        { error: "Sprint tem tasks atribuídas. Mova ou exclua as tasks antes de deletar a sprint." },
        { status: 409 },
      );
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true, id });
}
