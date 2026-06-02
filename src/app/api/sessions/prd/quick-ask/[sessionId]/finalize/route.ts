import { NextRequest, NextResponse } from "next/server";
import { requireSessionAccessApi } from "@/lib/dal";
import { finalizePrdLauncherSession } from "@/lib/sessions/prd-session/dal";
import { z } from "zod";

const RequestSchema = z.object({
  brief: z.string().max(2000).optional(),
});

/**
 * PATCH /api/sessions/prd/quick-ask/[sessionId]/finalize
 * Finaliza o launcher (OK): valida brief≥10 OU ≥1 insumo linkado, seta
 * launcherBrief + status=in_progress. Retorna 202; 422 se sem brief e sem insumo.
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> },
) {
  try {
    const { sessionId } = await params;

    const denied = await requireSessionAccessApi(sessionId);
    if (denied) return denied;

    const body = await req.json().catch(() => ({}));
    const parsed = RequestSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Validação falhou", details: parsed.error.flatten() },
        { status: 400 },
      );
    }

    const result = await finalizePrdLauncherSession({
      sessionId,
      brief: parsed.data.brief,
    });

    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: result.status });
    }

    return NextResponse.json({ sessionId: result.sessionId }, { status: 202 });
  } catch (error) {
    console.error("[PATCH /api/sessions/prd/quick-ask/[sessionId]/finalize]", error);
    return NextResponse.json(
      { error: "Erro interno ao finalizar session" },
      { status: 500 },
    );
  }
}
