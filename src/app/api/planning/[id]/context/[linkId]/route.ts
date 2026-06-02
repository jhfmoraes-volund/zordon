/**
 * DELETE /api/planning/[id]/context/[linkId]
 * Remove o link entre ContextSource e a Planning Ceremony (não apaga o ContextSource).
 */
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireProjectViewApi } from "@/lib/dal";
import { getPlanningById } from "@/lib/dal/planning";

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; linkId: string }> },
) {
  const { id: planningId, linkId } = await params;

  const planning = await getPlanningById(planningId);
  if (!planning) {
    return NextResponse.json({ error: "Planning não encontrada" }, { status: 404 });
  }
  const denied = await requireProjectViewApi(planning.projectId);
  if (denied) return denied;

  const { error } = await db()
    .from("EntityLink")
    .delete()
    .eq("id", linkId)
    .eq("planningCeremonyId", planningId);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
