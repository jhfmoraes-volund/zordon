import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireProjectViewApi } from "@/lib/dal";
import { requireCapabilityApi } from "@/lib/access/require-capability";
import {
  getSession,
  addLinkedPrd,
  listPrds,
} from "@/lib/dal/planning-session";
import { getPrdsForProject } from "@/lib/dal/product-requirements";

/**
 * GET — PRDs (ProductRequirement) do projeto vinculáveis ao release planning,
 * já excluindo os que estão no board.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: sessionId } = await params;

  const session = await getSession(sessionId);
  if (!session) {
    return NextResponse.json({ error: "session not found" }, { status: 404 });
  }
  const denied = await requireProjectViewApi(session.projectId);
  if (denied) return denied;

  try {
    const [universe, current] = await Promise.all([
      getPrdsForProject(session.projectId, { status: ["approved", "review"] }),
      listPrds(sessionId),
    ]);
    const linkedIds = new Set(
      current.map((p) => p.productRequirementId).filter(Boolean),
    );
    const available = universe
      .filter((p) => !linkedIds.has(p.id))
      .map((p) => ({
        id: p.id,
        reference: p.reference,
        title: p.title,
        status: p.status,
      }));
    return NextResponse.json({ prds: available });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "list failed";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

const linkSchema = z.object({
  productRequirementId: z.string().uuid(),
  sprintStart: z.number().int().min(1).max(12).optional(),
  sprintCount: z.number().int().min(1).max(6).optional(),
});

/**
 * POST — vincula um ProductRequirement a uma sprint do release planning.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: sessionId } = await params;

  const session = await getSession(sessionId);
  if (!session) {
    return NextResponse.json({ error: "session not found" }, { status: 404 });
  }
  const denied = await requireCapabilityApi("ritual.planning", {
    projectId: session.projectId,
  });
  if (denied) return denied;

  const body = await req.json().catch(() => null);
  const parsed = linkSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  try {
    const prd = await addLinkedPrd(sessionId, parsed.data.productRequirementId, {
      sprintStart: parsed.data.sprintStart ?? 1,
      sprintCount: parsed.data.sprintCount,
    });
    return NextResponse.json({ prd }, { status: 201 });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "link failed";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
