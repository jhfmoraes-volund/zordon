/**
 * GET    /api/pm-review/[id]   — detail
 * PATCH  /api/pm-review/[id]   — edit facilitator/referenceWeek/scheduledFor
 * DELETE /api/pm-review/[id]   — hard delete (qualquer status; cascata derruba notes/links)
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
import { requireCapabilityApi } from "@/lib/access/require-capability";

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

  const denied = await requireCapabilityApi("pm_review.write", { projectId });
  if (denied) return denied;

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

  const denied = await requireCapabilityApi("pm_review.write", { projectId });
  if (denied) return denied;

  // Hard delete em qualquer status. Cascata (ON DELETE CASCADE) derruba
  // PMReviewNote / PMReviewMeetingLink / PMReviewTranscriptLink / EntityLink.
  await deletePMReview(id);
  return NextResponse.json({ ok: true });
}
