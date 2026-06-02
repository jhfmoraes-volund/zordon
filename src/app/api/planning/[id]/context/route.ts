/**
 * GET /api/planning/[id]/context
 * Lista os ContextSource (insumos) linkados a uma Planning Ceremony.
 * Mesma forma do /api/planning-sessions/[id]/context.
 */
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireProjectViewApi } from "@/lib/dal";
import { getPlanningById } from "@/lib/dal/planning";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: planningId } = await params;

  const planning = await getPlanningById(planningId);
  if (!planning) {
    return NextResponse.json({ error: "Planning não encontrada" }, { status: 404 });
  }
  const denied = await requireProjectViewApi(planning.projectId);
  if (denied) return denied;

  const { data: links, error } = await db()
    .from("EntityLink")
    .select(
      `
      id,
      "contextSourceId",
      "linkedById",
      "linkedAt",
      weight,
      ContextSource:ContextSource!EntityLink_contextSourceId_fkey (
        id, kind, title, externalUrl, capturedAt, summary, projectId
      )
    `,
    )
    .eq("planningCeremonyId", planningId)
    .not("contextSourceId", "is", null)
    .order("linkedAt", { ascending: false });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const contextLinks = (links || []).map((link) => ({
    linkId: link.id,
    sourceId: link.contextSourceId,
    addedBy: link.linkedById,
    addedAt: link.linkedAt,
    weight: link.weight,
    source: link.ContextSource,
  }));

  return NextResponse.json({ contextLinks });
}
