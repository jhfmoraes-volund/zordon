import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getCurrentMember } from "@/lib/dal";
import { requireCapabilityApi } from "@/lib/access/require-capability";
import { z } from "zod";

const RequestSchema = z.object({
  prdIds: z.array(z.string().uuid()).min(1).max(10),
});

/**
 * PATCH /api/sessions/prd/approve
 * Batch approve: move PRDs de draft → ready.
 */
export async function PATCH(req: NextRequest) {
  try {
    const body = await req.json();
    const parsed = RequestSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: "Validação falhou", details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const { prdIds } = parsed.data;

    const denied = await requireCapabilityApi("prd.write");
    if (denied) return denied;

    const member = await getCurrentMember();
    if (!member) {
      return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
    }

    const nowIso = new Date().toISOString();
    const supabase = db();

    const { data, error } = await supabase
      .from("ProductRequirement")
      .update({
        status: "ready",
        approvedBy: member.id,
        approvedAt: nowIso,
        updatedAt: nowIso,
      })
      .in("id", prdIds)
      .select("id, title, status");

    if (error) {
      console.error("[PATCH /api/sessions/prd/approve]", error);
      return NextResponse.json(
        { error: "Erro ao aprovar PRDs" },
        { status: 500 }
      );
    }

    return NextResponse.json({ approved: data });
  } catch (error) {
    console.error("[PATCH /api/sessions/prd/approve]", error);
    return NextResponse.json(
      { error: "Erro interno ao aprovar PRDs" },
      { status: 500 }
    );
  }
}
