import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireMinLevelApi } from "@/lib/dal";
import { MANAGER } from "@/lib/roles";

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
  const denied = await requireMinLevelApi(MANAGER);
  if (denied) return denied;

  const { id: sprintId, memberId } = await params;
  const body = await req.json().catch(() => ({}));
  const fpAllocation = Number(body?.fpAllocation);

  if (!Number.isFinite(fpAllocation) || fpAllocation < 0) {
    return NextResponse.json({ error: "fpAllocation deve ser número >= 0" }, { status: 400 });
  }

  const supabase = db();

  // Valida que o membro está no projeto do sprint
  const { data: sprint } = await supabase
    .from("Sprint")
    .select("id, projectId")
    .eq("id", sprintId)
    .maybeSingle();
  if (!sprint) return NextResponse.json({ error: "Sprint not found" }, { status: 404 });

  const { data: pm } = await supabase
    .from("ProjectMember")
    .select("id")
    .eq("projectId", sprint.projectId)
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
  const denied = await requireMinLevelApi(MANAGER);
  if (denied) return denied;

  const { id: sprintId, memberId } = await params;
  const { error } = await db()
    .from("SprintMember")
    .delete()
    .eq("sprintId", sprintId)
    .eq("memberId", memberId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
