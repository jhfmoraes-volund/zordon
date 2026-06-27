import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { getActorMemberId } from "@/lib/dal";
import { requireCapabilityApi } from "@/lib/access/require-capability";
import { generateSprintGrid } from "@/lib/dal/generate-sprint-grid";

export const dynamic = "force-dynamic";

const bodySchema = z.object({
  dryRun: z.boolean().optional().default(false),
});

/**
 * POST /api/projects/:id/generate-sprints
 *
 * Gera a grade semanal (seg→dom) faltante entre a semana corrente e o prazo do
 * projeto. Núcleo em generateSprintGrid (compartilhado com o seed automático na
 * ativação do contrato). `{ dryRun: true }` devolve só o plano pro ConfirmDialog.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: projectId } = await params;
  const denied = await requireCapabilityApi("project.configure", {
    projectId,
  });
  if (denied) return denied;

  const parsed = bodySchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues }, { status: 400 });
  }

  const actorMemberId = await getActorMemberId();
  const result = await generateSprintGrid(db(), projectId, {
    dryRun: parsed.data.dryRun,
    actorMemberId,
  });

  if (!result.ok) {
    const status =
      result.reason === "project_not_found"
        ? 404
        : result.reason === "missing_dates"
          ? 422
          : result.reason === "conflict"
            ? 409
            : 500;
    return NextResponse.json({ error: result.message }, { status });
  }

  return NextResponse.json({
    ...result.plan,
    created: result.created,
    activatedSprintId: result.activatedSprintId,
  });
}
