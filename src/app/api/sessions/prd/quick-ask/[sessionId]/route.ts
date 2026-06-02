import { NextRequest, NextResponse } from "next/server";
import { requireSessionAccessApi } from "@/lib/dal";
import { deletePrdDraftSession } from "@/lib/sessions/prd-session/dal";

/**
 * DELETE /api/sessions/prd/quick-ask/[sessionId]
 * Limpa a session draft no cancel/fechar. No-op (204) se já finalizada
 * (deletePrdDraftSession só apaga quando status=draft).
 */
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> },
) {
  try {
    const { sessionId } = await params;

    const denied = await requireSessionAccessApi(sessionId);
    if (denied) return denied;

    await deletePrdDraftSession({ sessionId });

    return new NextResponse(null, { status: 204 });
  } catch (error) {
    console.error("[DELETE /api/sessions/prd/quick-ask/[sessionId]]", error);
    return NextResponse.json(
      { error: "Erro interno ao deletar session draft" },
      { status: 500 },
    );
  }
}
