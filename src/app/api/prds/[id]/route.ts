import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getActorMemberId } from "@/lib/dal";
import { requireCapabilityApi } from "@/lib/access/require-capability";
import {
  deletePrd,
  getPrdById,
  updatePrd,
  type ProductRequirementUpdate,
} from "@/lib/dal/product-requirements";
import {
  PrdAcceptanceCriterion,
  PrdDependency,
  PrdJourneyStep,
  PrdMetric,
  PrdRiskOrAssumption,
} from "@/lib/agent/agents/vitor/prd-schemas";

export const dynamic = "force-dynamic";

// PATCH body schema. Mirrors UpdatePrdInput but without projectId/designSessionId
// (immutable) and without `id` (comes from URL). All fields optional.
const PatchBody = z
  .object({
    moduleId: z.string().uuid().nullable().optional(),
    title: z.string().min(3).max(140).optional(),
    oneLiner: z.string().max(200).optional(),
    personaIds: z.array(z.string().uuid()).optional(),
    problem: z.string().optional(),
    goal: z.string().optional(),
    userJourney: z.array(PrdJourneyStep).optional(),
    acceptanceCriteria: z.array(PrdAcceptanceCriterion).optional(),
    successMetrics: z.array(PrdMetric).optional(),
    outOfScope: z.array(z.string()).optional(),
    dependencies: z.array(PrdDependency).optional(),
    technicalNotes: z.string().optional(),
    risksAndAssumptions: z.array(PrdRiskOrAssumption).optional(),
    sourceCardIds: z.array(z.string()).optional(),
    status: z.enum(["draft", "review"]).optional(),
  })
  .strict();

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, ctx: RouteContext) {
  const { id } = await ctx.params;
  const prd = await getPrdById(id);
  if (!prd) return NextResponse.json({ error: "not found" }, { status: 404 });

  // Reconcilia o gate legacy (requireMinLevelApi(BUILDER) + canViewProject):
  // project.view = manager bypass + ProjectAccess viewer+ + grant — mesmo nível.
  const denied = await requireCapabilityApi("project.view", {
    projectId: prd.projectId,
  });
  if (denied) return denied;

  return NextResponse.json({ data: prd });
}

export async function PATCH(req: NextRequest, ctx: RouteContext) {
  const { id } = await ctx.params;
  const current = await getPrdById(id);
  if (!current) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  // Reconcilia o gate legacy (requireMinLevelApi(BUILDER) + canEditTasks):
  // task.edit = manager bypass + ProjectAccess contributor/lead — mesmo nível.
  const denied = await requireCapabilityApi("task.edit", {
    projectId: current.projectId,
  });
  if (denied) return denied;

  if (current.status === "approved" || current.status === "superseded") {
    return NextResponse.json(
      {
        error: `PRD ${current.status} é imutável. Crie uma nova versão.`,
      },
      { status: 409 },
    );
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
  }

  const parsed = PatchBody.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 422 });
  }

  const memberId = await getActorMemberId();
  const patch = parsed.data as ProductRequirementUpdate;

  try {
    const updated = await updatePrd(id, patch, {
      actorAgent: undefined,
      actorMemberId: memberId,
    });
    return NextResponse.json({ data: updated });
  } catch (error) {
    console.error("PATCH /api/prds/[id] failed:", error);
    return NextResponse.json(
      { error: String((error as Error)?.message ?? error) },
      { status: 500 },
    );
  }
}

export async function DELETE(_req: NextRequest, ctx: RouteContext) {
  const { id } = await ctx.params;
  const current = await getPrdById(id);
  if (!current) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  // Reconcilia o gate legacy (requireMinLevelApi(BUILDER) + canEditTasks):
  // task.edit = manager bypass + ProjectAccess contributor/lead — mesmo nível.
  const denied = await requireCapabilityApi("task.edit", {
    projectId: current.projectId,
  });
  if (denied) return denied;

  try {
    await deletePrd(id);
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("DELETE /api/prds/[id] failed:", error);
    return NextResponse.json(
      { error: String((error as Error)?.message ?? error) },
      { status: 500 },
    );
  }
}
