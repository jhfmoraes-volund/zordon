/**
 * GET    /api/pm-review/[id]   — detail
 * PATCH  /api/pm-review/[id]   — edit facilitator/referenceWeek/scheduledFor
 * DELETE /api/pm-review/[id]   — hard delete (apenas em draft; published → archive)
 */
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import {
  getPMReview,
  updatePMReview,
  deletePMReview,
  mondayOf,
} from "@/lib/dal/pm-review";
import { requireProjectViewApi } from "@/lib/dal";
import { canCreatePMReviewForProject } from "@/lib/pm-review/permission";

async function loadProjectId(id: string): Promise<string | null> {
  const { data } = await db()
    .from("PMReview")
    .select("projectId")
    .eq("id", id)
    .maybeSingle();
  return (data?.projectId as string | undefined) ?? null;
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const projectId = await loadProjectId(id);
  if (!projectId)
    return NextResponse.json({ error: "PM Review não encontrado" }, { status: 404 });

  const denied = await requireProjectViewApi(projectId);
  if (denied) return denied;

  const detail = await getPMReview(id);
  if (!detail)
    return NextResponse.json({ error: "PM Review não encontrado" }, { status: 404 });
  return NextResponse.json(detail);
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const projectId = await loadProjectId(id);
  if (!projectId)
    return NextResponse.json({ error: "PM Review não encontrado" }, { status: 404 });

  const allowed = await canCreatePMReviewForProject(projectId);
  if (!allowed)
    return NextResponse.json(
      { error: "Apenas PMs (lead) ou admins podem editar." },
      { status: 403 },
    );

  const body = (await req.json().catch(() => null)) as {
    referenceWeek?: string | null;
    facilitatorId?: string | null;
    scheduledFor?: string | null;
  } | null;
  if (!body)
    return NextResponse.json({ error: "Body inválido" }, { status: 400 });

  const patch: Parameters<typeof updatePMReview>[1] = {};
  if (body.referenceWeek !== undefined) {
    patch.referenceWeek = body.referenceWeek
      ? mondayOf(new Date(body.referenceWeek))
      : undefined;
  }
  if (body.facilitatorId !== undefined) patch.facilitatorId = body.facilitatorId;
  if (body.scheduledFor !== undefined) patch.scheduledFor = body.scheduledFor;

  try {
    const updated = await updatePMReview(id, patch);
    return NextResponse.json(updated);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("PMReview_project_week_key") || msg.includes("23505")) {
      return NextResponse.json(
        { error: "Já existe PM Review para essa semana." },
        { status: 409 },
      );
    }
    return NextResponse.json(
      { error: "Falha ao atualizar PM Review", detail: msg },
      { status: 500 },
    );
  }
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const projectId = await loadProjectId(id);
  if (!projectId)
    return NextResponse.json({ error: "PM Review não encontrado" }, { status: 404 });

  const allowed = await canCreatePMReviewForProject(projectId);
  if (!allowed)
    return NextResponse.json(
      { error: "Apenas PMs (lead) ou admins podem excluir." },
      { status: 403 },
    );

  // Política: hard delete só em draft. published/archived → use /archive.
  const detail = await getPMReview(id);
  if (!detail)
    return NextResponse.json({ error: "PM Review não encontrado" }, { status: 404 });
  if (detail.status !== "draft") {
    return NextResponse.json(
      {
        error:
          "PM Review já publicado não pode ser excluído. Use /archive pra remover da lista ativa.",
      },
      { status: 409 },
    );
  }

  await deletePMReview(id);
  return NextResponse.json({ ok: true });
}
