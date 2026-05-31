import { NextRequest, NextResponse } from "next/server";
import { requireSessionAccessApi } from "@/lib/dal";
import { getPrdsForSession } from "@/lib/dal/product-requirements";

/**
 * GET /api/design-sessions/[id]/prds
 *
 * Lista PRDs (ProductRequirement) vinculados à DesignSession.
 * Usado pelo PrdBriefingStep (PRD list lateral em sessions tipo `prd_session`).
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: sessionId } = await params;

  const denied = await requireSessionAccessApi(sessionId);
  if (denied) return denied;

  const prds = await getPrdsForSession(sessionId);
  return NextResponse.json({ prds });
}
