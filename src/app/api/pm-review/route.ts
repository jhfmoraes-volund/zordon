/**
 * POST /api/pm-review
 *
 * Cria um PMReview em status='draft' para o projeto + semana. Body:
 *   { projectId, referenceWeek?, facilitatorId?, scheduledFor? }
 *
 * `referenceWeek` é forçado pra segunda da semana (se vier outra data,
 * normaliza no DAL).
 *
 * Auth: caller precisa de admin global OU ProjectAccess.role='lead'.
 */
import { NextRequest, NextResponse } from "next/server";
import { requireProjectViewApi } from "@/lib/dal";
import { canCreatePMReviewForProject } from "@/lib/pm-review/permission";
import { createPMReview, mondayOf } from "@/lib/dal/pm-review";

type Body = {
  projectId?: string;
  referenceWeek?: string | null;
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

  const allowed = await canCreatePMReviewForProject(body.projectId);
  if (!allowed) {
    return NextResponse.json(
      { error: "Apenas PMs (lead) ou admins podem criar PM Reviews." },
      { status: 403 },
    );
  }

  // Normaliza referenceWeek → segunda da semana.
  const week = body.referenceWeek
    ? mondayOf(new Date(body.referenceWeek))
    : mondayOf(new Date());

  try {
    const created = await createPMReview({
      projectId: body.projectId,
      referenceWeek: week,
      facilitatorId: body.facilitatorId ?? null,
      scheduledFor: body.scheduledFor ?? new Date().toISOString(),
    });
    return NextResponse.json(created, { status: 201 });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    // 23505 = unique violation (projectId, referenceWeek).
    if (msg.includes("PMReview_project_week_key") || msg.includes("23505")) {
      return NextResponse.json(
        { error: "Já existe PM Review para esta semana neste projeto." },
        { status: 409 },
      );
    }
    return NextResponse.json(
      { error: "Falha ao criar PM Review", detail: msg },
      { status: 500 },
    );
  }
}
