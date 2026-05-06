import { db } from "@/lib/db";
import { NextRequest, NextResponse } from "next/server";
import { getUser } from "@/lib/dal";
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

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getUser();
  if (!user) return new NextResponse("Unauthorized", { status: 401 });

  const { id } = await params;
  const { error } = await db().from("Sprint").delete().eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, id });
}
