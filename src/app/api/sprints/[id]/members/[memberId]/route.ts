import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireCapabilityApi } from "@/lib/access/require-capability";
import { projectIdForSprint } from "@/lib/dal/sprint";

/**
 * PATCH /api/sprints/[id]/members/[memberId]
 * Body: { fpAllocation: number }
 *
 * Cria ou atualiza SprintMember — override por sprint. Quando presente,
 * sobrescreve ProjectMember.fpAllocation naquele sprint específico.
 * Útil pra: férias, crunch, redistribuição pontual.
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; memberId: string }> },
) {
  const { id: sprintId, memberId } = await params;

  const projectId = await projectIdForSprint(sprintId);
  if (!projectId) return NextResponse.json({ error: "Sprint not found" }, { status: 404 });

  // Override de alocação (fpAllocation) por sprint = ato de staffing → manager+
  // (preserva a regra anterior requireMinLevelApi(MANAGER), não afrouxa).
  const denied = await requireCapabilityApi("member.write");
  if (denied) return denied;

  const body = await req.json().catch(() => ({}));
  const fpAllocation = Number(body?.fpAllocation);

  if (!Number.isFinite(fpAllocation) || fpAllocation < 0) {
    return NextResponse.json({ error: "fpAllocation deve ser número >= 0" }, { status: 400 });
  }

  const supabase = db();

  // Valida que o membro está no projeto do sprint
  const { data: pm } = await supabase
    .from("ProjectMember")
    .select("id")
    .eq("projectId", projectId)
    .eq("memberId", memberId)
    .maybeSingle();
  if (!pm) {
    return NextResponse.json(
      { error: "Membro não está alocado ao projeto deste sprint" },
      { status: 400 },
    );
  }

  const { error } = await supabase.from("SprintMember").upsert(
    {
      sprintId,
      memberId,
      fpAllocation,
      updatedAt: new Date().toISOString(),
    },
    { onConflict: "sprintId,memberId" },
  );
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true, sprintId, memberId, fpAllocation });
}

/**
 * DELETE /api/sprints/[id]/members/[memberId]
 *
 * Remove o override. O membro volta ao ProjectMember.fpAllocation padrão
 * daquele projeto para esse sprint.
 */
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; memberId: string }> },
) {
  const { id: sprintId, memberId } = await params;

  const projectId = await projectIdForSprint(sprintId);
  if (!projectId) return NextResponse.json({ error: "Sprint not found" }, { status: 404 });

  // Override de alocação (fpAllocation) por sprint = ato de staffing → manager+
  // (preserva a regra anterior requireMinLevelApi(MANAGER), não afrouxa).
  const denied = await requireCapabilityApi("member.write");
  if (denied) return denied;

  const { error } = await db()
    .from("SprintMember")
    .delete()
    .eq("sprintId", sprintId)
    .eq("memberId", memberId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
