import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireCapabilityApi } from "@/lib/access/require-capability";

/**
 * PATCH /api/projects/[id]/members/[memberId]
 * Body: { fpAllocation: number }
 *
 * Atualiza (ou cria) a ProjectMember entre projeto e membro. Se a row já
 * existe, faz UPDATE; caso contrário, INSERT. Não toca no projeto nem em
 * outros membros — operação granular.
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; memberId: string }> },
) {
  // Alocação por projeto é gestão de time → manager+ (coerente com o override
  // de sprint, que já exige manager, e com /members/[id] gateado em manager).
  const denied = await requireCapabilityApi("member.write");
  if (denied) return denied;

  const { id: projectId, memberId } = await params;
  const body = await req.json().catch(() => ({}));
  const fpAllocation = Number(body?.fpAllocation);

  if (!Number.isFinite(fpAllocation) || fpAllocation < 0) {
    return NextResponse.json({ error: "fpAllocation deve ser número >= 0" }, { status: 400 });
  }

  const supabase = db();
  const { data: existing } = await supabase
    .from("ProjectMember")
    .select("id")
    .eq("projectId", projectId)
    .eq("memberId", memberId)
    .maybeSingle();

  if (existing) {
    const { error } = await supabase
      .from("ProjectMember")
      .update({ fpAllocation })
      .eq("id", existing.id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  } else {
    const { error } = await supabase.from("ProjectMember").insert({
      id: crypto.randomUUID(),
      projectId,
      memberId,
      fpAllocation,
    });
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, projectId, memberId, fpAllocation });
}

/**
 * DELETE /api/projects/[id]/members/[memberId]
 * Remove o vínculo do membro ao projeto.
 */
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; memberId: string }> },
) {
  const denied = await requireCapabilityApi("member.write");
  if (denied) return denied;

  const { id: projectId, memberId } = await params;
  const { error } = await db()
    .from("ProjectMember")
    .delete()
    .eq("projectId", projectId)
    .eq("memberId", memberId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
