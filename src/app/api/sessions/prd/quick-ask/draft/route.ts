import { NextRequest, NextResponse } from "next/server";
import { getCurrentMember } from "@/lib/dal";
import { requireCapabilityApi } from "@/lib/access/require-capability";
import { createPrdDraftSession } from "@/lib/sessions/prd-session/dal";
import { z } from "zod";

const RequestSchema = z.object({
  projectId: z.string().uuid(),
});

/**
 * POST /api/sessions/prd/quick-ask/draft
 * Cria a DesignSession draft ao abrir o launcher (QAL-003).
 * Insumos linkam ao vivo nessa session; finalização vem no PATCH /finalize.
 * Retorna 202 + sessionId.
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const parsed = RequestSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Validação falhou", details: parsed.error.flatten() },
        { status: 400 },
      );
    }

    const denied = await requireCapabilityApi("session.edit", {
      projectId: parsed.data.projectId,
    });
    if (denied) return denied;

    const member = await getCurrentMember();
    if (!member) {
      return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
    }

    const { sessionId } = await createPrdDraftSession({
      projectId: parsed.data.projectId,
      actorMemberId: member.id,
    });

    return NextResponse.json({ sessionId }, { status: 202 });
  } catch (error) {
    console.error("[POST /api/sessions/prd/quick-ask/draft]", error);
    return NextResponse.json(
      { error: "Erro interno ao criar session draft" },
      { status: 500 },
    );
  }
}
