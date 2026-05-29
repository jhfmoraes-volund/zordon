/**
 * POST /api/pm-review/[id]/publish — `draft → published`.
 *
 * Published continua editável (PM pode adicionar notes, regerar report).
 * É marcador de "tá disponível pra consulta", não "fechado".
 */
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { transitionPMReviewStatus } from "@/lib/dal/pm-review";
import { canCreatePMReviewForProject } from "@/lib/pm-review/permission";

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  const { data } = await db()
    .from("PMReview")
    .select("projectId")
    .eq("id", id)
    .maybeSingle();
  const projectId = (data?.projectId as string | undefined) ?? null;
  if (!projectId)
    return NextResponse.json({ error: "PM Review não encontrado" }, { status: 404 });

  const allowed = await canCreatePMReviewForProject(projectId);
  if (!allowed)
    return NextResponse.json(
      { error: "Apenas PMs (lead) ou admins podem publicar." },
      { status: 403 },
    );

  try {
    const updated = await transitionPMReviewStatus(id, "published");
    return NextResponse.json(updated);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { error: "Falha ao publicar", detail: msg },
      { status: 409 },
    );
  }
}
