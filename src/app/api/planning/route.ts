/**
 * POST /api/planning
 * Cria uma PlanningCeremony em phase='idle'.
 *
 * Body: { projectId, sprintId?, facilitatorId?, scheduledFor? }
 * Auth: caller precisa ter acesso ao projeto (canViewProject).
 *       Banco enforces UNIQUE(projectId, sprintId) — duplicata vira 409.
 */
import { NextRequest, NextResponse } from "next/server";
import { requireProjectViewApi } from "@/lib/dal";
import { createPlanning } from "@/lib/dal/planning";

type Body = {
  projectId: string;
  sprintId?: string | null;
  facilitatorId?: string | null;
  scheduledFor?: string | null;
};

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => null)) as Body | null;
  if (!body?.projectId) {
    return NextResponse.json({ error: "projectId obrigatório" }, { status: 400 });
  }

  const denied = await requireProjectViewApi(body.projectId);
  if (denied) return denied;

  try {
    const planning = await createPlanning({
      projectId: body.projectId,
      sprintId: body.sprintId ?? null,
      facilitatorId: body.facilitatorId ?? null,
      scheduledFor: body.scheduledFor ?? null,
    });
    return NextResponse.json(planning, { status: 201 });
  } catch (err) {
    // UNIQUE violation → 409
    const msg = String(err);
    if (msg.includes("duplicate key") || msg.includes("23505")) {
      return NextResponse.json(
        { error: "Já existe Planning pra esse projeto+sprint" },
        { status: 409 },
      );
    }
    return NextResponse.json({ error: "Falha ao criar Planning", detail: msg }, { status: 500 });
  }
}
